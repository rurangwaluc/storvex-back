// src/modules/employees/employee.controller.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");

const ALLOWED_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "CASHIER",
  "SELLER",
  "STOREKEEPER",
  "TECHNICIAN",
]);

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const v = String(value || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;

  return null;
}

function normalizeEmail(value) {
  const s = cleanString(value);
  return s ? s.toLowerCase() : null;
}

function normalizePhone(value) {
  const s = cleanString(value);
  if (!s) return null;
  return s.replace(/[^\d+]/g, "") || null;
}

function requireTenantId(req) {
  const tenantId = cleanString(req.user?.tenantId || req.tenantId);
  return tenantId || null;
}

function publicEmployee(user) {
  if (!user) return null;

  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt || null,
  };
}

function seatMetaFromReq(req) {
  return {
    subscription: req.subscriptionMeta || null,
    seatUsage: req.seatUsage || req.subscriptionUsage || null,
  };
}

async function hashPassword(rawPassword) {
  return bcrypt.hash(String(rawPassword), 12);
}

function validateRoleOrThrow(role) {
  const normalized = normalizeRole(role);

  if (!ALLOWED_ROLES.has(normalized)) {
    const err = new Error("Invalid role");
    err.status = 400;
    throw err;
  }

  return normalized;
}

function validatePasswordOrThrow(password, fieldName = "password") {
  const raw = String(password || "");

  if (raw.length < 6) {
    const err = new Error(`${fieldName} must be at least 6 characters`);
    err.status = 400;
    throw err;
  }

  return raw;
}

async function getEmployeeOrThrow(tenantId, employeeId) {
  const employee = await prisma.user.findFirst({
    where: {
      id: employeeId,
      tenantId,
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      createdAt: true,
      password: true,
    },
  });

  if (!employee) {
    const err = new Error("Employee not found");
    err.status = 404;
    throw err;
  }

  return employee;
}

async function ensureSingleOwnerRule(tenantId, nextRole, employeeIdToIgnore = null) {
  if (nextRole !== "OWNER") return;

  const existingOwner = await prisma.user.findFirst({
    where: {
      tenantId,
      role: "OWNER",
      ...(employeeIdToIgnore ? { id: { not: employeeIdToIgnore } } : {}),
    },
    select: { id: true },
  });

  if (existingOwner) {
    const err = new Error("This tenant already has an owner account");
    err.status = 400;
    throw err;
  }
}

function ensureNotDangerousOwnerMutation(existing, nextRole, nextIsActive) {
  const isOwner = normalizeRole(existing?.role) === "OWNER";
  if (!isOwner) return;

  if (nextRole && normalizeRole(nextRole) !== "OWNER") {
    const err = new Error("Owner role cannot be changed");
    err.status = 400;
    throw err;
  }

  if (typeof nextIsActive === "boolean" && nextIsActive === false) {
    const err = new Error("Owner account cannot be deactivated");
    err.status = 400;
    throw err;
  }
}

function ensureNotSelfDangerousMutation(req, existing, nextRole, nextIsActive) {
  const authUserId = cleanString(req.user?.id);
  if (!authUserId || authUserId !== existing.id) return;

  if (nextRole && normalizeRole(nextRole) !== normalizeRole(existing.role)) {
    const err = new Error("You cannot change your own role");
    err.status = 400;
    throw err;
  }

  if (typeof nextIsActive === "boolean" && nextIsActive === false) {
    const err = new Error("You cannot deactivate your own account");
    err.status = 400;
    throw err;
  }
}

async function listEmployees(req, res) {
  try {
    const tenantId = requireTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const q = cleanString(req.query?.q);
    const role = cleanString(req.query?.role);
    const isActiveRaw = normalizeBoolean(req.query?.isActive);

    const where = {
      tenantId,
    };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    if (role) {
      where.role = normalizeRole(role);
    }

    if (typeof isActiveRaw === "boolean") {
      where.isActive = isActiveRaw;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });

    return res.json({
      employees: users.map(publicEmployee),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("listEmployees error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to load employees",
    });
  }
}

async function createEmployee(req, res) {
  try {
    const tenantId = requireTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const name = cleanString(req.body?.name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const role = validateRoleOrThrow(req.body?.role);
    const password = validatePasswordOrThrow(req.body?.password);

    if (!name) {
      return res.status(400).json({ message: "name is required" });
    }

    if (!email) {
      return res.status(400).json({ message: "email is required" });
    }

    await ensureSingleOwnerRule(tenantId, role);

    const hashedPassword = await hashPassword(password);

    const created = await prisma.user.create({
      data: {
        tenantId,
        name,
        email,
        phone,
        role,
        isActive: true,
        password: hashedPassword,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      created: true,
      employee: publicEmployee(created),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("createEmployee error:", err);

    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "An employee with this email already exists",
        code: "EMPLOYEE_EMAIL_EXISTS",
        ...seatMetaFromReq(req),
      });
    }

    return res.status(err.status || 500).json({
      message: err.message || "Failed to create employee",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function updateEmployee(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const employeeId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId) {
      return res.status(400).json({ message: "Employee id is required" });
    }

    const existing = await getEmployeeOrThrow(tenantId, employeeId);

    const name = req.body?.name === undefined ? undefined : cleanString(req.body?.name);
    const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body?.email);
    const phone = req.body?.phone === undefined ? undefined : normalizePhone(req.body?.phone);
    const role = req.body?.role === undefined ? undefined : validateRoleOrThrow(req.body?.role);
    const isActive =
      req.body?.isActive === undefined ? undefined : normalizeBoolean(req.body?.isActive);

    if (req.body?.isActive !== undefined && isActive === null) {
      return res.status(400).json({ message: "isActive must be boolean" });
    }

    ensureNotDangerousOwnerMutation(existing, role, isActive);
    ensureNotSelfDangerousMutation(req, existing, role, isActive);

    if (role) {
      await ensureSingleOwnerRule(tenantId, role, existing.id);
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (typeof isActive === "boolean") data.isActive = isActive;

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.json({
      updated: true,
      employee: publicEmployee(updated),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("updateEmployee error:", err);

    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "An employee with this email already exists",
        code: "EMPLOYEE_EMAIL_EXISTS",
        ...seatMetaFromReq(req),
      });
    }

    return res.status(err.status || 500).json({
      message: err.message || "Failed to update employee",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function setEmployeeActiveStatus(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const employeeId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId) {
      return res.status(400).json({ message: "Employee id is required" });
    }

    const isActive = normalizeBoolean(req.body?.isActive);
    if (isActive === null) {
      return res.status(400).json({ message: "isActive must be boolean" });
    }

    const existing = await getEmployeeOrThrow(tenantId, employeeId);

    ensureNotDangerousOwnerMutation(existing, existing.role, isActive);
    ensureNotSelfDangerousMutation(req, existing, existing.role, isActive);

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.json({
      updated: true,
      employee: publicEmployee(updated),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("setEmployeeActiveStatus error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to update employee status",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function resetEmployeePassword(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const employeeId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId) {
      return res.status(400).json({ message: "Employee id is required" });
    }

    const existing = await getEmployeeOrThrow(tenantId, employeeId);

    let nextPassword = cleanString(req.body?.password || req.body?.newPassword);
    if (!nextPassword && req.body?.generate === true) {
      nextPassword = crypto.randomBytes(4).toString("hex");
    }

    if (!nextPassword) {
      return res.status(400).json({
        message: "password or newPassword is required",
      });
    }

    validatePasswordOrThrow(nextPassword, "password");

    const hashedPassword = await hashPassword(nextPassword);

    await prisma.user.update({
      where: { id: existing.id },
      data: { password: hashedPassword },
    });

    return res.json({
      updated: true,
      message: "Password reset successful",
      employeeId: existing.id,
      generatedPassword: req.body?.generate === true ? nextPassword : undefined,
    });
  } catch (err) {
    console.error("resetEmployeePassword error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to reset employee password",
    });
  }
}

async function deleteEmployee(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const employeeId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!employeeId) {
      return res.status(400).json({ message: "Employee id is required" });
    }

    const existing = await getEmployeeOrThrow(tenantId, employeeId);

    if (normalizeRole(existing.role) === "OWNER") {
      return res.status(400).json({
        message: "Owner account cannot be deleted",
      });
    }

    if (cleanString(req.user?.id) === existing.id) {
      return res.status(400).json({
        message: "You cannot delete your own account",
      });
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        isActive: false,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.json({
      deleted: true,
      employee: publicEmployee(updated),
      message: "Employee deactivated successfully",
    });
  } catch (err) {
    console.error("deleteEmployee error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to delete employee",
    });
  }
}

module.exports = {
  listEmployees,
  createEmployee,
  updateEmployee,
  setEmployeeActiveStatus,
  resetEmployeePassword,
  deleteEmployee,
};