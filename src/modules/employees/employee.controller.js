const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");

// CREATE EMPLOYEE (OWNER)
async function createEmployee(req, res) {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // Global unique email in your schema, so this is correct
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        tenantId: req.user.tenantId,
        name,
        email,
        password: hash,
        role,
        phone: phone || "",
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        createdAt: true,
      },
    });

    return res.status(201).json(user);
  } catch (err) {
    console.error("Error creating employee:", err);
    return res.status(500).json({ message: "Failed to create employee" });
  }
}

// LIST EMPLOYEES (optionally filter by role)
async function listEmployees(req, res) {
  try {
    const { role } = req.query; // ?role=TECHNICIAN
    const where = { tenantId: req.user.tenantId };
    if (role) where.role = role;

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Prepare the response including subscription status
    const response = {
      employees: users,
      message: req.subscription?.inGrace
        ? "Subscription is in grace period. Renew soon."
        : "Subscription is active.",
      warning: req.subscription?.inGrace || false,  // Set warning flag if in grace period
    };

    return res.json(response);
  } catch (err) {
    console.error("Error listing employees:", err);
    return res.status(500).json({ message: "Failed to list employees" });
  }
}

// UPDATE EMPLOYEE (must be same tenant)
async function updateEmployee(req, res) {
  try {
    const { name, email, role, password } = req.body;
    const id = req.params.id;

    if (!name || !email || !role) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // Ensure employee exists AND belongs to tenant (P0: tenant isolation)
    const existing = await prisma.user.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });

    if (!existing) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Check email uniqueness (global unique)
    const emailOwner = await prisma.user.findUnique({ where: { email } });
    if (emailOwner && emailOwner.id !== id) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const data = { name, email, role };

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      data.password = hash;
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("Error updating employee:", err);
    return res.status(500).json({ message: "Failed to update employee" });
  }
}

// DELETE EMPLOYEE (must be same tenant)
async function deleteEmployee(req, res) {
  try {
    const id = req.params.id;

    const existing = await prisma.user.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Employee not found" });
    }

    await prisma.user.delete({ where: { id } });

    return res.json({ message: "Employee removed" });
  } catch (err) {
    console.error("Error deleting employee:", err);
    return res.status(500).json({ message: "Failed to delete employee" });
  }
}

// LIST TECHNICIANS
async function listTechnicians(req, res) {
  try {
    const technicians = await prisma.user.findMany({
      where: {
        tenantId: req.user.tenantId,
        role: "TECHNICIAN",
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Prepare the response including subscription status
    const response = {
      technicians,
      message: req.subscription?.inGrace
        ? "Subscription is in grace period. Renew soon."
        : "Subscription is active.",
      warning: req.subscription?.inGrace || false,  // Set warning flag if in grace period
    };

    return res.json(response);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch technicians" });
  }
}

module.exports = {
  createEmployee,
  listEmployees,
  updateEmployee,
  deleteEmployee,
  listTechnicians,
};
