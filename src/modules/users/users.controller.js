// src/modules/users/users.controller.js
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

function publicUser(user) {
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

async function getUserOrThrow(tenantId, userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
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

  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }

  return user;
}

async function ensureSingleOwnerRule(tenantId, nextRole, userIdToIgnore = null) {
  if (nextRole !== "OWNER") return;

  const existingOwner = await prisma.user.findFirst({
    where: {
      tenantId,
      role: "OWNER",
      ...(userIdToIgnore ? { id: { not: userIdToIgnore } } : {}),
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

async function listUsers(req, res) {
  try {
    const tenantId = requireTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const q = cleanString(req.query?.q);
    const role = cleanString(req.query?.role);
    const isActiveRaw = normalizeBoolean(req.query?.isActive);

    const where = { tenantId };

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
      users: users.map(publicUser),
      employees: users.map(publicUser),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("listUsers error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to load users",
    });
  }
}

async function getUser(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const userId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const user = await getUserOrThrow(tenantId, userId);

    return res.json({
      user: publicUser(user),
      employee: publicUser(user),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("getUser error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to load user",
    });
  }
}

async function createUser(req, res) {
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
      user: publicUser(created),
      employee: publicUser(created),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("createUser error:", err);

    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "A user with this email already exists",
        code: "USER_EMAIL_EXISTS",
        ...seatMetaFromReq(req),
      });
    }

    return res.status(err.status || 500).json({
      message: err.message || "Failed to create user",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function updateUser(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const userId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const existing = await getUserOrThrow(tenantId, userId);

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
      user: publicUser(updated),
      employee: publicUser(updated),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("updateUser error:", err);

    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "A user with this email already exists",
        code: "USER_EMAIL_EXISTS",
        ...seatMetaFromReq(req),
      });
    }

    return res.status(err.status || 500).json({
      message: err.message || "Failed to update user",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function setUserActiveStatus(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const userId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const isActive = normalizeBoolean(req.body?.isActive);
    if (isActive === null) {
      return res.status(400).json({ message: "isActive must be boolean" });
    }

    const existing = await getUserOrThrow(tenantId, userId);

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
      user: publicUser(updated),
      employee: publicUser(updated),
      ...seatMetaFromReq(req),
    });
  } catch (err) {
    console.error("setUserActiveStatus error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to update user status",
      ...(err.code === "STAFF_LIMIT_REACHED" ? err.meta || {} : {}),
      ...seatMetaFromReq(req),
    });
  }
}

async function resetUserPassword(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const userId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const existing = await getUserOrThrow(tenantId, userId);

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
      userId: existing.id,
      generatedPassword: req.body?.generate === true ? nextPassword : undefined,
    });
  } catch (err) {
    console.error("resetUserPassword error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to reset user password",
    });
  }
}

async function deleteUser(req, res) {
  try {
    const tenantId = requireTenantId(req);
    const userId = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const existing = await getUserOrThrow(tenantId, userId);

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
      data: { isActive: false },
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
      user: publicUser(updated),
      employee: publicUser(updated),
      message: "User deactivated successfully",
    });
  } catch (err) {
    console.error("deleteUser error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to delete user",
    });
  }
}

module.exports = {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserActiveStatus,
  resetUserPassword,
  deleteUser,

  // compatibility aliases so routes do not break if naming differs
  listEmployees: listUsers,
  getEmployee: getUser,
  createEmployee: createUser,
  updateEmployee: updateUser,
  setEmployeeActiveStatus: setUserActiveStatus,
  resetEmployeePassword: resetUserPassword,
  deleteEmployee: deleteUser,
};