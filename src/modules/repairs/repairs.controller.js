// src/modules/repairs/repairs.controller.js
const prisma = require("../../config/database");
const { RepairStatus, UserRole } = require("@prisma/client");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function resolveRepairBranchScope(req) {
  const requestedBranchId =
    cleanString(req.query?.branchId) ||
    cleanString(req.headers["x-branch-id"]) ||
    null;

  const allBranchesRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (allBranchesRequested) {
    if (!canViewAllBranches(req)) {
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
      throw e;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(requestedBranchId)) {
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
      throw e;
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      allowedBranchIds,
    };
  }

  return {
    mode: "SINGLE_BRANCH",
    branchId: getActiveBranchId(req),
    allowedBranchIds,
  };
}

function applyRepairBranchScope(where, scope) {
  const next = { ...(where || {}) };

  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    const e = new Error("BRANCH_REQUIRED");
    e.code = "BRANCH_REQUIRED";
    throw e;
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(branchId)) {
    const e = new Error("BRANCH_ACCESS_DENIED");
    e.code = "BRANCH_ACCESS_DENIED";
    throw e;
  }

  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      tenantId,
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
    },
  });

  if (!branch) {
    const e = new Error("BRANCH_NOT_FOUND");
    e.code = "BRANCH_NOT_FOUND";
    throw e;
  }

  if (branch.status !== "ACTIVE") {
    const e = new Error("BRANCH_NOT_ACTIVE");
    e.code = "BRANCH_NOT_ACTIVE";
    throw e;
  }

  return branch;
}

// CREATE REPAIR
async function createRepair(req, res) {
  const { customerId, device, serial, issue, warrantyEnd } = req.body;
  const tenantId = getTenantId(req);

  if (!customerId || !device || !issue) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const activeBranch = await ensureWritableBranchAccessOrThrow(req);

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });

    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const repairData = {
      tenantId,
      customerId,
      device: cleanString(device),
      serial: cleanString(serial),
      issue: cleanString(issue),
      status: RepairStatus.RECEIVED,
      warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
    };

    if (typeof prisma.repair.fields?.branchId !== "undefined") {
      repairData.branchId = activeBranch.id;
    }

    if (typeof prisma.repair.fields?.createdById !== "undefined") {
      repairData.createdById = getUserId(req);
    }

    const repair = await prisma.repair.create({
      data: repairData,
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    return res.status(201).json(repair);
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (code === "BRANCH_REQUIRED" || msg === "BRANCH_REQUIRED") {
      return res.status(400).json({ message: "No active branch selected", code: "BRANCH_REQUIRED" });
    }
    if (code === "BRANCH_ACCESS_DENIED" || msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied", code: "BRANCH_ACCESS_DENIED" });
    }
    if (code === "BRANCH_NOT_FOUND" || msg === "BRANCH_NOT_FOUND") {
      return res.status(404).json({ message: "Branch not found" });
    }
    if (code === "BRANCH_NOT_ACTIVE" || msg === "BRANCH_NOT_ACTIVE") {
      return res.status(409).json({ message: "Selected branch is not active" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to create repair" });
  }
}

// LIST REPAIRS
async function getRepairs(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const repairs = await prisma.repair.findMany({
      where: applyRepairBranchScope({ tenantId }, scope),
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    return res.json({
      repairs,
      count: repairs.length,
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch repairs" });
  }
}

// GET SINGLE REPAIR
async function getRepairById(req, res) {
  const { id } = req.params;

  try {
    const scope = resolveRepairBranchScope(req);

    const repair = await prisma.repair.findFirst({
      where: applyRepairBranchScope(
        { id, tenantId: getTenantId(req) },
        scope
      ),
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    if (!repair) return res.status(404).json({ message: "Repair not found" });

    return res.json(repair);
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch repair" });
  }
}

// UPDATE REPAIR (all fields)
async function updateRepair(req, res) {
  const { id } = req.params;
  const { device, serial, issue, warrantyEnd } = req.body;

  try {
    const scope = resolveRepairBranchScope(req);

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope(
        { id, tenantId: getTenantId(req) },
        scope
      ),
      data: {
        ...(device !== undefined ? { device: cleanString(device) } : {}),
        ...(serial !== undefined ? { serial: cleanString(serial) } : {}),
        ...(issue !== undefined ? { issue: cleanString(issue) } : {}),
        ...(warrantyEnd !== undefined
          ? { warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null }
          : {}),
      },
    });

    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });

    const updated = await prisma.repair.findFirst({
      where: { id, tenantId: getTenantId(req) },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    return res.json(updated || { message: "Repair updated" });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to update repair" });
  }
}

// UPDATE STATUS ONLY
async function updateRepairStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ message: "Status is required" });

  if (!Object.values(RepairStatus).includes(status)) {
    return res.status(400).json({
      message: `status must be one of ${Object.values(RepairStatus).join(", ")}`,
    });
  }

  try {
    const scope = resolveRepairBranchScope(req);
    const userRole = String(req.user?.role || "").toUpperCase();
    const tenantId = getTenantId(req);

    const repair = await prisma.repair.findFirst({
      where: applyRepairBranchScope(
        { id, tenantId },
        scope
      ),
      select: {
        id: true,
        tenantId: true,
        technicianId: true,
      },
    });

    if (!repair) {
      return res.status(404).json({ message: "Repair not found" });
    }

    if (userRole === "TECHNICIAN") {
      const currentUserId = getUserId(req);
      if (!repair.technicianId || String(repair.technicianId) !== String(currentUserId)) {
        return res.status(403).json({
          message: "Technician can only update assigned repairs",
          code: "REPAIR_ASSIGNMENT_REQUIRED",
        });
      }
    }

    const result = await prisma.repair.updateMany({
      where: { id, tenantId },
      data: { status },
    });

    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });

    const updated = await prisma.repair.findFirst({
      where: { id, tenantId },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    return res.json(updated || { message: "Repair status updated" });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to update status" });
  }
}

// Assign or unassign technician
async function assignTechnician(req, res) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const raw = req.body?.technicianId;
  const technicianId = raw === "" || raw == null ? null : String(raw);

  try {
    const scope = resolveRepairBranchScope(req);

    const repair = await prisma.repair.findFirst({
      where: applyRepairBranchScope(
        { id, tenantId },
        scope
      ),
      select: {
        id: true,
        tenantId: true,
        ...(typeof prisma.repair.fields?.branchId !== "undefined" ? { branchId: true } : {}),
      },
    });

    if (!repair) {
      return res.status(404).json({ message: "Repair not found" });
    }

    if (technicianId) {
      const techWhere = {
        id: technicianId,
        tenantId,
        role: UserRole.TECHNICIAN,
      };

      if (typeof prisma.user.fields?.branchId !== "undefined" && repair.branchId) {
        techWhere.OR = [
          { branchId: repair.branchId },
          { branchId: null },
        ];
      }

      const tech = await prisma.user.findFirst({
        where: techWhere,
        select: { id: true },
      });

      if (!tech) {
        return res.status(400).json({ message: "Invalid technicianId" });
      }
    }

    const result = await prisma.repair.updateMany({
      where: { id, tenantId },
      data: { technicianId },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    const updated = await prisma.repair.findFirst({
      where: { id, tenantId },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
        ...(typeof prisma.repair.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
      },
    });

    return res.status(200).json(updated);
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("Error assigning/unassigning technician:", err);
    return res.status(500).json({ message: "Failed to assign/unassign technician" });
  }
}

// ARCHIVE (soft delete)
async function archiveRepair(req, res) {
  const { id } = req.params;

  try {
    const scope = resolveRepairBranchScope(req);

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope(
        { id, tenantId: getTenantId(req) },
        scope
      ),
      data: { status: RepairStatus.DELIVERED },
    });

    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair archived" });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to archive repair" });
  }
}

// DELETE (hard delete)
async function deleteRepair(req, res) {
  const { id } = req.params;

  try {
    const scope = resolveRepairBranchScope(req);

    const result = await prisma.repair.deleteMany({
      where: applyRepairBranchScope(
        { id, tenantId: getTenantId(req) },
        scope
      ),
    });

    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair deleted" });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to delete repair" });
  }
}

// GET ALL TECHNICIANS
async function getTechnicians(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const technicianWhere = {
      tenantId,
      role: "TECHNICIAN",
    };

    if (scope.mode === "SINGLE_BRANCH" && scope.branchId && typeof prisma.user.fields?.branchId !== "undefined") {
      technicianWhere.OR = [
        { branchId: scope.branchId },
        { branchId: null },
      ];
    }

    const technicians = await prisma.user.findMany({
      where: technicianWhere,
      select: {
        id: true,
        name: true,
        ...(typeof prisma.user.fields?.branchId !== "undefined" ? { branchId: true } : {}),
      },
    });

    return res.json({
      technicians,
      count: technicians.length,
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch technicians" });
  }
}

module.exports = {
  createRepair,
  getRepairs,
  getRepairById,
  updateRepair,
  updateRepairStatus,
  assignTechnician,
  archiveRepair,
  deleteRepair,
  getTechnicians,
};