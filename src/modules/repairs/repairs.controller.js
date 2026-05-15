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

function hasRepairBranchField() {
  return typeof prisma.repair.fields?.branchId !== "undefined";
}

function hasRepairCreatedByField() {
  return typeof prisma.repair.fields?.createdById !== "undefined";
}

function hasUserBranchField() {
  return typeof prisma.user.fields?.branchId !== "undefined";
}

function createCodedError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function businessLocationLabel(location) {
  const code = cleanString(location?.code);
  const name = cleanString(location?.name);

  if (code && name) return `${code} • ${name}`;
  if (name) return name;
  if (code) return code;

  return null;
}

function toBusinessLocation(location) {
  if (!location) return null;

  return {
    id: location.id,
    name: location.name || null,
    code: location.code || null,
    status: location.status || null,
    isMain: Boolean(location.isMain),
    label: businessLocationLabel(location),
  };
}

function formatRepairScopeForResponse(scope) {
  if (!scope) {
    return {
      mode: "CURRENT_LOCATION",
      storeLocationId: null,
      allowedStoreLocationIds: [],
    };
  }

  return {
    mode: scope.mode === "ALL_BRANCHES" ? "ALL_LOCATIONS" : "CURRENT_LOCATION",
    storeLocationId: scope.branchId || null,
    allowedStoreLocationIds: Array.isArray(scope.allowedBranchIds) ? scope.allowedBranchIds : [],
  };
}

function includeRepairRelations() {
  return {
    customer: {
      select: {
        id: true,
        name: true,
        phone: true,
      },
    },
    technician: {
      select: {
        id: true,
        name: true,
      },
    },
    ...(hasRepairBranchField()
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
  };
}

function decorateRepair(repair) {
  if (!repair) return repair;

  const next = {
    ...repair,
    storeLocation: toBusinessLocation(repair.branch),
  };

  return next;
}

function decorateRepairs(repairs) {
  return Array.isArray(repairs) ? repairs.map(decorateRepair) : [];
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
      throw createCodedError("BRANCH_ACCESS_DENIED");
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (
      !canViewAllBranches(req) &&
      allowedBranchIds.length > 0 &&
      !allowedBranchIds.includes(requestedBranchId)
    ) {
      throw createCodedError("BRANCH_ACCESS_DENIED");
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

  if (hasRepairBranchField() && scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    throw createCodedError("BRANCH_REQUIRED");
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (
    !canViewAllBranches(req) &&
    allowedBranchIds.length > 0 &&
    !allowedBranchIds.includes(branchId)
  ) {
    throw createCodedError("BRANCH_ACCESS_DENIED");
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
    throw createCodedError("BRANCH_NOT_FOUND");
  }

  if (branch.status !== "ACTIVE") {
    throw createCodedError("BRANCH_NOT_ACTIVE");
  }

  return branch;
}

function sendRepairLocationError(res, err) {
  const code = String(err?.code || err?.message || "");

  if (code === "BRANCH_REQUIRED") {
    return res.status(400).json({
      message: "No active store location selected",
      code: "STORE_LOCATION_REQUIRED",
    });
  }

  if (code === "BRANCH_ACCESS_DENIED") {
    return res.status(403).json({
      message: "You do not have access to this store location",
      code: "STORE_LOCATION_ACCESS_DENIED",
    });
  }

  if (code === "BRANCH_NOT_FOUND") {
    return res.status(404).json({
      message: "Store location not found",
      code: "STORE_LOCATION_NOT_FOUND",
    });
  }

  if (code === "BRANCH_NOT_ACTIVE") {
    return res.status(409).json({
      message: "Selected store location is not active",
      code: "STORE_LOCATION_NOT_ACTIVE",
    });
  }

  return null;
}

function normalizeWarrantyEnd(value) {
  if (value === undefined) return undefined;
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createCodedError("INVALID_WARRANTY_DATE");
  }

  return date;
}

function normalizeRepairStatus(value) {
  const status = cleanString(value);

  if (!status) {
    throw createCodedError("STATUS_REQUIRED");
  }

  if (!Object.values(RepairStatus).includes(status)) {
    throw createCodedError("INVALID_REPAIR_STATUS");
  }

  return status;
}

async function findScopedRepairOrThrow(req, id, extraSelect = {}) {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    throw createCodedError("UNAUTHORIZED");
  }

  const scope = resolveRepairBranchScope(req);

  const repair = await prisma.repair.findFirst({
    where: applyRepairBranchScope({ id, tenantId }, scope),
    select: {
      id: true,
      tenantId: true,
      technicianId: true,
      ...(hasRepairBranchField() ? { branchId: true } : {}),
      ...extraSelect,
    },
  });

  if (!repair) {
    throw createCodedError("REPAIR_NOT_FOUND");
  }

  return { repair, scope, tenantId };
}

// CREATE REPAIR
async function createRepair(req, res) {
  const { customerId, device, serial, issue, warrantyEnd } = req.body;
  const tenantId = getTenantId(req);

  if (!customerId || !cleanString(device) || !cleanString(issue)) {
    return res.status(400).json({
      message: "Customer, device, and issue are required",
    });
  }

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const activeLocation = await ensureWritableBranchAccessOrThrow(req);

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const repairData = {
      tenantId,
      customerId,
      device: cleanString(device),
      serial: cleanString(serial),
      issue: cleanString(issue),
      status: RepairStatus.RECEIVED,
      warrantyEnd: warrantyEnd ? normalizeWarrantyEnd(warrantyEnd) : null,
    };

    if (hasRepairBranchField()) {
      repairData.branchId = activeLocation.id;
    }

    if (hasRepairCreatedByField()) {
      repairData.createdById = getUserId(req);
    }

    const repair = await prisma.repair.create({
      data: repairData,
      include: includeRepairRelations(),
    });

    return res.status(201).json({
      repair: decorateRepair(repair),
      message: "Repair created",
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    if (String(err?.code || err?.message || "") === "INVALID_WARRANTY_DATE") {
      return res.status(400).json({ message: "Warranty date is invalid" });
    }

    console.error("Failed to create repair:", err);
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
      include: includeRepairRelations(),
    });

    const decorated = decorateRepairs(repairs);

    return res.json({
      repairs: decorated,
      count: decorated.length,
      storeLocationScope: formatRepairScopeForResponse(scope),
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    console.error("Failed to fetch repairs:", err);
    return res.status(500).json({ message: "Failed to fetch repairs" });
  }
}

// GET SINGLE REPAIR
async function getRepairById(req, res) {
  const { id } = req.params;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const repair = await prisma.repair.findFirst({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      include: includeRepairRelations(),
    });

    if (!repair) {
      return res.status(404).json({ message: "Repair not found" });
    }

    return res.json({
      repair: decorateRepair(repair),
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    console.error("Failed to fetch repair:", err);
    return res.status(500).json({ message: "Failed to fetch repair" });
  }
}

// UPDATE REPAIR DETAILS
async function updateRepair(req, res) {
  const { id } = req.params;
  const { device, serial, issue, warrantyEnd } = req.body;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const data = {
      ...(device !== undefined ? { device: cleanString(device) } : {}),
      ...(serial !== undefined ? { serial: cleanString(serial) } : {}),
      ...(issue !== undefined ? { issue: cleanString(issue) } : {}),
    };

    if (warrantyEnd !== undefined) {
      data.warrantyEnd = normalizeWarrantyEnd(warrantyEnd);
    }

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      data,
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    const updated = await prisma.repair.findFirst({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      include: includeRepairRelations(),
    });

    return res.json({
      repair: decorateRepair(updated),
      message: "Repair updated",
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    if (String(err?.code || err?.message || "") === "INVALID_WARRANTY_DATE") {
      return res.status(400).json({ message: "Warranty date is invalid" });
    }

    console.error("Failed to update repair:", err);
    return res.status(500).json({ message: "Failed to update repair" });
  }
}

// UPDATE STATUS ONLY
async function updateRepairStatus(req, res) {
  const { id } = req.params;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const status = normalizeRepairStatus(req.body?.status);
    const userRole = String(req.user?.role || "").toUpperCase();

    const { repair, scope } = await findScopedRepairOrThrow(req, id);

    if (userRole === "TECHNICIAN") {
      const currentUserId = getUserId(req);

      if (!repair.technicianId || String(repair.technicianId) !== String(currentUserId)) {
        return res.status(403).json({
          message: "Technicians can only update repairs assigned to them",
          code: "REPAIR_ASSIGNMENT_REQUIRED",
        });
      }
    }

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      data: { status },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    const updated = await prisma.repair.findFirst({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      include: includeRepairRelations(),
    });

    return res.json({
      repair: decorateRepair(updated),
      message: "Repair status updated",
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    const code = String(err?.code || err?.message || "");

    if (code === "STATUS_REQUIRED") {
      return res.status(400).json({ message: "Status is required" });
    }

    if (code === "INVALID_REPAIR_STATUS") {
      return res.status(400).json({
        message: `Status must be one of ${Object.values(RepairStatus).join(", ")}`,
      });
    }

    if (code === "REPAIR_NOT_FOUND") {
      return res.status(404).json({ message: "Repair not found" });
    }

    console.error("Failed to update repair status:", err);
    return res.status(500).json({ message: "Failed to update status" });
  }
}

// ASSIGN OR UNASSIGN TECHNICIAN
async function assignTechnician(req, res) {
  const tenantId = getTenantId(req);
  const { id } = req.params;

  const raw = req.body?.technicianId;
  const technicianId = raw === "" || raw == null ? null : String(raw);

  try {
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const { repair, scope } = await findScopedRepairOrThrow(req, id);

    if (technicianId) {
      const techWhere = {
        id: technicianId,
        tenantId,
        role: UserRole.TECHNICIAN,
      };

      if (hasUserBranchField() && repair.branchId) {
        techWhere.OR = [{ branchId: repair.branchId }, { branchId: null }];
      }

      const technician = await prisma.user.findFirst({
        where: techWhere,
        select: { id: true },
      });

      if (!technician) {
        return res.status(400).json({
          message: "Selected technician is not available for this store location",
          code: "TECHNICIAN_NOT_AVAILABLE",
        });
      }
    }

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      data: { technicianId },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    const updated = await prisma.repair.findFirst({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      include: includeRepairRelations(),
    });

    return res.status(200).json({
      repair: decorateRepair(updated),
      message: technicianId ? "Technician assigned" : "Technician removed",
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    if (String(err?.code || err?.message || "") === "REPAIR_NOT_FOUND") {
      return res.status(404).json({ message: "Repair not found" });
    }

    console.error("Failed to assign or remove technician:", err);
    return res.status(500).json({ message: "Failed to update technician assignment" });
  }
}

// ARCHIVE REPAIR
async function archiveRepair(req, res) {
  const { id } = req.params;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const result = await prisma.repair.updateMany({
      where: applyRepairBranchScope({ id, tenantId }, scope),
      data: { status: RepairStatus.DELIVERED },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    return res.json({ message: "Repair archived" });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    console.error("Failed to archive repair:", err);
    return res.status(500).json({ message: "Failed to archive repair" });
  }
}

// DELETE REPAIR
async function deleteRepair(req, res) {
  const { id } = req.params;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const result = await prisma.repair.deleteMany({
      where: applyRepairBranchScope({ id, tenantId }, scope),
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Repair not found" });
    }

    return res.json({ message: "Repair deleted" });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    console.error("Failed to delete repair:", err);
    return res.status(500).json({ message: "Failed to delete repair" });
  }
}

// GET TECHNICIANS
async function getTechnicians(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveRepairBranchScope(req);

    const technicianWhere = {
      tenantId,
      role: UserRole.TECHNICIAN,
    };

    if (scope.mode === "SINGLE_BRANCH" && scope.branchId && hasUserBranchField()) {
      technicianWhere.OR = [{ branchId: scope.branchId }, { branchId: null }];
    }

    const technicians = await prisma.user.findMany({
      where: technicianWhere,
      select: {
        id: true,
        name: true,
        ...(hasUserBranchField() ? { branchId: true } : {}),
      },
      orderBy: {
        name: "asc",
      },
    });

    return res.json({
      technicians,
      count: technicians.length,
      storeLocationScope: formatRepairScopeForResponse(scope),
    });
  } catch (err) {
    const locationError = sendRepairLocationError(res, err);
    if (locationError) return locationError;

    console.error("Failed to fetch technicians:", err);
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