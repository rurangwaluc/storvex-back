// backend/src/modules/employees/employee.controller.js
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");

const ALLOWED_ROLES = new Set([
  "MANAGER",
  "CASHIER",
  "SELLER",
  "STOREKEEPER",
  "TECHNICIAN",
]);

const SYSTEM_ROLES = new Set(["OWNER", "PLATFORM_ADMIN"]);

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
  return cleanString(req.user?.tenantId || req.tenantId);
}

function getActorUserId(req) {
  return cleanString(req.user?.userId || req.user?.id);
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
    const err = new Error(
      "Invalid role. Staff role must be MANAGER, CASHIER, SELLER, STOREKEEPER, or TECHNICIAN"
    );
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

function normalizeBranchIds(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const ids = [];

  for (const item of value) {
    const id = cleanString(item);
    if (!id || seen.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function serializeBranchAssignment(assignment) {
  if (!assignment) return null;

  return {
    id: assignment.id,
    tenantId: assignment.tenantId,
    userId: assignment.userId,
    branchId: assignment.branchId,
    isDefault: Boolean(assignment.isDefault),
    canOperate: assignment.canOperate !== false,
    canViewReports: Boolean(assignment.canViewReports),
    branch: assignment.branch
      ? {
          id: assignment.branch.id,
          tenantId: assignment.branch.tenantId,
          name: assignment.branch.name,
          code: assignment.branch.code,
          type: assignment.branch.type,
          status: assignment.branch.status,
          phone: assignment.branch.phone || null,
          email: assignment.branch.email || null,
          countryCode: assignment.branch.countryCode || "RW",
          district: assignment.branch.district || null,
          sector: assignment.branch.sector || null,
          address: assignment.branch.address || null,
          isMain: Boolean(assignment.branch.isMain),
        }
      : null,
  };
}

function publicEmployee(user) {
  if (!user) return null;

  const branchAssignments = Array.isArray(user.branchAssignments)
    ? user.branchAssignments.map(serializeBranchAssignment).filter(Boolean)
    : [];

  const branches = branchAssignments
    .map((assignment) => ({
      ...(assignment.branch || {}),
      isDefault: Boolean(assignment.isDefault),
      canOperate: Boolean(assignment.canOperate),
      canViewReports: Boolean(assignment.canViewReports),
    }))
    .filter((branch) => branch?.id);

  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt || null,
    branchAssignments,
    branches,
  };
}

function employeeSelect() {
  return {
    id: true,
    tenantId: true,
    name: true,
    email: true,
    phone: true,
    role: true,
    isActive: true,
    createdAt: true,
    branchAssignments: {
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        tenantId: true,
        userId: true,
        branchId: true,
        isDefault: true,
        canOperate: true,
        canViewReports: true,
        branch: {
          select: {
            id: true,
            tenantId: true,
            name: true,
            code: true,
            type: true,
            status: true,
            phone: true,
            email: true,
            countryCode: true,
            district: true,
            sector: true,
            address: true,
            isMain: true,
          },
        },
      },
    },
  };
}

async function getEmployeeOrThrow(tenantId, employeeId) {
  const employee = await prisma.user.findFirst({
    where: {
      id: employeeId,
      tenantId,
    },
    select: {
      ...employeeSelect(),
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

function ensureProtectedAccountIsNotMutated(existing, nextRole, nextIsActive) {
  const existingRole = normalizeRole(existing?.role);

  if (!SYSTEM_ROLES.has(existingRole)) return;

  if (nextRole && normalizeRole(nextRole) !== existingRole) {
    const err = new Error(`${existingRole} role cannot be changed`);
    err.status = 400;
    throw err;
  }

  if (typeof nextIsActive === "boolean" && nextIsActive === false) {
    const err = new Error(`${existingRole} account cannot be deactivated`);
    err.status = 400;
    throw err;
  }
}

function ensureNotSelfDangerousMutation(req, existing, nextRole, nextIsActive) {
  const authUserId = getActorUserId(req);
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

function ensureCanResetPassword(req, existing) {
  const actorUserId = getActorUserId(req);
  const existingRole = normalizeRole(existing?.role);

  if (actorUserId && actorUserId === existing.id) {
    const err = new Error("Use the account password-change flow to reset your own password");
    err.status = 400;
    throw err;
  }

  if (SYSTEM_ROLES.has(existingRole)) {
    const err = new Error(`${existingRole} password cannot be reset from staff management`);
    err.status = 400;
    throw err;
  }
}

async function getTenantBranches(tenantId) {
  return prisma.branch.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      tenantId: true,
      isMain: true,
    },
  });
}

async function getDefaultBranchForTenant(tenantId) {
  const branch = await prisma.branch.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
    },
  });

  return branch?.id || null;
}

async function assertBranchesBelongToTenant(tenantId, branchIds) {
  const cleanIds = normalizeBranchIds(branchIds);

  if (!cleanIds.length) return [];

  const found = await prisma.branch.findMany({
    where: {
      tenantId,
      id: { in: cleanIds },
      status: "ACTIVE",
    },
    select: {
      id: true,
    },
  });

  const foundIds = new Set(found.map((branch) => branch.id));

  const missing = cleanIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    const err = new Error("One or more selected branches are invalid");
    err.status = 400;
    err.code = "INVALID_BRANCH_SELECTION";
    throw err;
  }

  return cleanIds;
}

async function replaceUserBranchAssignmentsTx(tx, { tenantId, userId, branchIds, defaultBranchId }) {
  const selectedBranchIds = normalizeBranchIds(branchIds);

  await tx.userBranchAssignment.deleteMany({
    where: {
      tenantId,
      userId,
    },
  });

  if (!selectedBranchIds.length) return;

  const cleanDefaultBranchId =
    cleanString(defaultBranchId) && selectedBranchIds.includes(cleanString(defaultBranchId))
      ? cleanString(defaultBranchId)
      : selectedBranchIds[0];

  await tx.userBranchAssignment.createMany({
    data: selectedBranchIds.map((branchId) => ({
      tenantId,
      userId,
      branchId,
      isDefault: branchId === cleanDefaultBranchId,
      canOperate: true,
      canViewReports: true,
    })),
    skipDuplicates: true,
  });
}

async function resolveBranchAssignmentInput({ tenantId, role, payload, existingEmployee = null }) {
  const body = payload || {};
  const requestedBranchIds = normalizeBranchIds(body.branchIds);
  const requestedDefaultBranchId = cleanString(body.defaultBranchId);
  const canViewAllBranches = normalizeBoolean(body.canViewAllBranches) === true;

  if (canViewAllBranches) {
    const branches = await getTenantBranches(tenantId);
    const branchIds = branches.map((branch) => branch.id);
    const mainBranchId = branches.find((branch) => branch.isMain)?.id || branchIds[0] || null;

    return {
      shouldUpdateAssignments: true,
      branchIds,
      defaultBranchId: mainBranchId,
    };
  }

  if (role === "OWNER") {
    const branches = await getTenantBranches(tenantId);
    const branchIds = branches.map((branch) => branch.id);
    const mainBranchId = branches.find((branch) => branch.isMain)?.id || branchIds[0] || null;

    return {
      shouldUpdateAssignments: true,
      branchIds,
      defaultBranchId: mainBranchId,
    };
  }

  if ("branchIds" in body || "defaultBranchId" in body) {
    const branchIds = await assertBranchesBelongToTenant(tenantId, requestedBranchIds);

    if (branchIds.length === 0) {
      const fallbackBranchId = await getDefaultBranchForTenant(tenantId);

      return {
        shouldUpdateAssignments: true,
        branchIds: fallbackBranchId ? [fallbackBranchId] : [],
        defaultBranchId: fallbackBranchId,
      };
    }

    if (requestedDefaultBranchId && !branchIds.includes(requestedDefaultBranchId)) {
      const err = new Error("Default branch must be one of the selected branches");
      err.status = 400;
      err.code = "INVALID_DEFAULT_BRANCH";
      throw err;
    }

    return {
      shouldUpdateAssignments: true,
      branchIds,
      defaultBranchId: requestedDefaultBranchId || branchIds[0],
    };
  }

  if (existingEmployee) {
    return {
      shouldUpdateAssignments: false,
      branchIds: [],
      defaultBranchId: null,
    };
  }

  const fallbackBranchId = await getDefaultBranchForTenant(tenantId);

  return {
    shouldUpdateAssignments: true,
    branchIds: fallbackBranchId ? [fallbackBranchId] : [],
    defaultBranchId: fallbackBranchId,
  };
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
      select: employeeSelect(),
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

    const assignmentInput = await resolveBranchAssignmentInput({
      tenantId,
      role,
      payload: req.body || {},
    });

    const hashedPassword = await hashPassword(password);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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
        },
      });

      await replaceUserBranchAssignmentsTx(tx, {
        tenantId,
        userId: user.id,
        branchIds: assignmentInput.branchIds,
        defaultBranchId: assignmentInput.defaultBranchId,
      });

      return tx.user.findFirst({
        where: {
          id: user.id,
          tenantId,
        },
        select: employeeSelect(),
      });
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

    ensureProtectedAccountIsNotMutated(existing, role, isActive);
    ensureNotSelfDangerousMutation(req, existing, role, isActive);

    const nextRole = role || existing.role;

    const assignmentInput = await resolveBranchAssignmentInput({
      tenantId,
      role: nextRole,
      payload: req.body || {},
      existingEmployee: existing,
    });

    const data = {};
    if (name !== undefined) data.name = name;
    if (email !== undefined) data.email = email;
    if (phone !== undefined) data.phone = phone;
    if (role !== undefined) data.role = role;
    if (typeof isActive === "boolean") data.isActive = isActive;

    if (req.body?.password) {
      data.password = await hashPassword(validatePasswordOrThrow(req.body.password));
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });

      if (assignmentInput.shouldUpdateAssignments) {
        await replaceUserBranchAssignmentsTx(tx, {
          tenantId,
          userId: existing.id,
          branchIds: assignmentInput.branchIds,
          defaultBranchId: assignmentInput.defaultBranchId,
        });
      }

      return tx.user.findFirst({
        where: {
          id: existing.id,
          tenantId,
        },
        select: employeeSelect(),
      });
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

    ensureProtectedAccountIsNotMutated(existing, existing.role, isActive);
    ensureNotSelfDangerousMutation(req, existing, existing.role, isActive);

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { isActive },
      select: employeeSelect(),
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

    ensureCanResetPassword(req, existing);

    let nextPassword = cleanString(req.body?.password || req.body?.newPassword);
    const generated = req.body?.generate === true;

    if (!nextPassword && generated) {
      nextPassword = crypto.randomBytes(5).toString("hex");
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
      select: { id: true },
    });

    return res.json({
      updated: true,
      message: "Password reset successful",
      employeeId: existing.id,
      generatedPassword: generated ? nextPassword : undefined,
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
    const existingRole = normalizeRole(existing.role);

    if (SYSTEM_ROLES.has(existingRole)) {
      return res.status(400).json({
        message: `${existingRole} account cannot be deleted`,
      });
    }

    if (getActorUserId(req) === existing.id) {
      return res.status(400).json({
        message: "You cannot delete your own account",
      });
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        isActive: false,
      },
      select: employeeSelect(),
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