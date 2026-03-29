// src/controllers/repairs.controller.js
const prisma = require("../../config/database");
const { RepairStatus, UserRole } = require("@prisma/client");

// CREATE REPAIR
async function createRepair(req, res) {
  const { customerId, device, serial, issue, warrantyEnd } = req.body;

  if (!customerId || !device || !issue) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // ✅ Tenant-safe: customer must belong to the same tenant
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId: req.user.tenantId },
  });

  if (!customer) return res.status(404).json({ message: "Customer not found" });

  try {
    const repair = await prisma.repair.create({
      data: {
        tenantId: req.user.tenantId,
        customerId,
        device,
        serial,
        issue,
        status: RepairStatus.RECEIVED,
        warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
      },
    });

    return res.status(201).json(repair);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to create repair" });
  }
}

// LIST REPAIRS
async function getRepairs(req, res) {
  try {
    const repairs = await prisma.repair.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
      },
    });
    return res.json(repairs);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch repairs" });
  }
}

// GET SINGLE REPAIR
async function getRepairById(req, res) {
  const { id } = req.params;
  try {
    const repair = await prisma.repair.findFirst({
      where: { id, tenantId: req.user.tenantId },
      include: {
        customer: { select: { name: true, phone: true } },
        technician: { select: { name: true } },
      },
    });
    if (!repair) return res.status(404).json({ message: "Repair not found" });
    return res.json(repair);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch repair" });
  }
}

// UPDATE REPAIR (all fields)
async function updateRepair(req, res) {
  const { id } = req.params;
  const { device, serial, issue, warrantyEnd } = req.body;

  try {
    const result = await prisma.repair.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data: {
        device,
        serial,
        issue,
        warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
      },
    });
    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair updated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to update repair" });
  }
}

// UPDATE STATUS ONLY
async function updateRepairStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) return res.status(400).json({ message: "Status is required" });

  // ✅ Enum validation
  if (!Object.values(RepairStatus).includes(status)) {
    return res.status(400).json({
      message: `status must be one of ${Object.values(RepairStatus).join(", ")}`,
    });
  }

  try {
    const result = await prisma.repair.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data: { status },
    });
    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair status updated" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to update status" });
  }
}


// Assign or unassign technician
async function assignTechnician(req, res) {
  const tenantId = req.user.tenantId;
  const { id } = req.params;

  // allow "" to mean unassign
  const raw = req.body?.technicianId;
  const technicianId = raw === "" || raw == null ? null : String(raw);

  try {
    // ✅ If assigning (not unassigning), technician must exist in this tenant and be TECHNICIAN
    if (technicianId) {
      const tech = await prisma.user.findFirst({
        where: { id: technicianId, tenantId, role: UserRole.TECHNICIAN },
        select: { id: true },
      });
      if (!tech) {
        return res.status(400).json({ message: "Invalid technicianId" });
      }
    }

    // ✅ Tenant-safe + race-safe update
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
      },
    });

    return res.status(200).json(updated);
  } catch (err) {
    console.error("Error assigning/unassigning technician:", err);
    return res.status(500).json({ message: "Failed to assign/unassign technician" });
  }
}



// ARCHIVE (soft delete)
async function archiveRepair(req, res) {
  const { id } = req.params;

  try {
    const result = await prisma.repair.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data: { status: "DELIVERED" },
    });
    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair archived" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to archive repair" });
  }
}

// DELETE (hard delete)
async function deleteRepair(req, res) {
  const { id } = req.params;

  try {
    const result = await prisma.repair.deleteMany({
      where: { id, tenantId: req.user.tenantId },
    });
    if (result.count === 0) return res.status(404).json({ message: "Repair not found" });
    return res.json({ message: "Repair deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to delete repair" });
  }
}

// GET ALL TECHNICIANS
async function getTechnicians(req, res) {
  try {
    const technicians = await prisma.user.findMany({
      where: {
        tenantId: req.user.tenantId,
        role: "TECHNICIAN",
      },
      select: {
        id: true,
        name: true,
      },
    });

    return res.json(technicians);
  } catch (err) {
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
  getTechnicians
};
