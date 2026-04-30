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

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function getViewerBranchId(req) {
  return cleanString(req.user?.branchId || req.user?.defaultBranchId || null);
}

function getAllowedBranchIds(req) {
  return Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds.filter(Boolean).map((x) => String(x))
    : [];
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

function normalizeAssignmentInput(item) {
  if (!item || typeof item !== "object") return null;

  const branchId = cleanString(item.branchId);
  if (!branchId) return null;

  return {
    branchId,
    isDefault: normalizeBoolean(item.isDefault) === true,
    canOperate:
      item.canOperate === undefined ? true : normalizeBoolean(item.canOperate) !== false,
    canViewReports: normalizeBoolean(item.canViewReports) === true,
  };
}

function dedupeAssignments(assignments = []) {
  const map = new Map();

  for (const item of assignments) {
    const normalized = normalizeAssignmentInput(item);
    if (!normalized) continue;

    const existing = map.get(normalized.branchId);
    if (!existing) {
      map.set(normalized.branchId, normalized);
      continue;
    }

    map.set(normalized.branchId, {
      branchId: normalized.branchId,
      isDefault: existing.isDefault || normalized.isDefault,
      canOperate: existing.canOperate || normalized.canOperate,
      canViewReports: existing.canViewReports || normalized.canViewReports,
    });
  }

  return Array.from(map.values());
}

function normalizeAssignmentsPayload(req, role, body) {
  const normalizedRole = normalizeRole(role);

  if (normalizedRole === "OWNER") {
    return [];
  }

  let assignments = [];

  if (Array.isArray(body?.branchAssignments)) {
    assignments = dedupeAssignments(body.branchAssignments);
  } else {
    const singleBranchId = cleanString(body?.branchId);
    if (singleBranchId) {
      assignments = [
        {
          branchId: singleBranchId,
          isDefault: true,
          canOperate: true,
          canViewReports: normalizedRole === "MANAGER",
        },
      ];
    }
  }

  if (!assignments.length) {
    const viewerBranchId = getViewerBranchId(req);
    if (viewerBranchId && !canViewAllBranches(req)) {
      assignments = [
        {
          branchId: viewerBranchId,
          isDefault: true,
          canOperate: true,
          canViewReports: normalizedRole === "MANAGER",
        },
      ];
    }
  }

  if (!assignments.length) {
    const err = new Error("At least one branch assignment is required for non-owner staff");
    err.status = 400;
    throw err;
  }

  const defaultCount = assignments.filter((x) => x.isDefault).length;
  if (defaultCount === 0) {
    assignments[0].isDefault = true;
  } else if (defaultCount > 1) {
    let picked = false;
    assignments = assignments.map((x) => {
      if (x.isDefault && !picked) {
        picked = true;
        return x;
      }
      return { ...x, isDefault: false };
    });
  }

  return assignments;
}

async function getBranchMap(tenantId, branchIds = []) {
  const ids = Array.from(new Set((branchIds || []).filter(Boolean).map((x) => String(x))));
  if (!ids.length) return new Map();

  const rows = await prisma.branch.findMany({
    where: {
      tenantId,
      id: { in: ids },
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
      type: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name || null,
        code: row.code || null,
        status: row.status || null,
        isMain: Boolean(row.isMain),
        type: row.type || null,
      },
    ])
  );
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
      branchAssignments: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          branchId: true,
          isDefault: true,
          canOperate: true,
          canViewReports: true,
          createdAt: true,
        },
      },
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
  const authUserId = cleanString(req.user?.id || req.user?.userId);
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

function resolveUsersBranchScope(req) {
  const tenantId = requireTenantId(req);
  if (!tenantId) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const requestedBranchId = cleanString(
    req.query?.branchId || req.headers["x-branch-id"] || null
  );
  const allBranchesRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const viewerCanViewAllBranches = canViewAllBranches(req);
  const allowedBranchIds = getAllowedBranchIds(req);
  const viewerBranchId = getViewerBranchId(req);

  if (allBranchesRequested) {
    if (!viewerCanViewAllBranches) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      throw err;
    }

    return {
      tenantId,
      mode: "ALL_BRANCHES",
      branchId: null,
      requestedBranchId: null,
      allowedBranchIds,
      canViewAllBranches: viewerCanViewAllBranches,
      label: "All branches",
    };
  }

  if (requestedBranchId) {
    if (
      !viewerCanViewAllBranches &&
      allowedBranchIds.length > 0 &&
      !allowedBranchIds.includes(requestedBranchId)
    ) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      err.branchId = requestedBranchId;
      throw err;
    }

    return {
      tenantId,
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      requestedBranchId,
      allowedBranchIds,
      canViewAllBranches: viewerCanViewAllBranches,
      label: requestedBranchId,
    };
  }

  if (viewerBranchId && !viewerCanViewAllBranches) {
    return {
      tenantId,
      mode: "SINGLE_BRANCH",
      branchId: viewerBranchId,
      requestedBranchId: null,
      allowedBranchIds,
      canViewAllBranches: viewerCanViewAllBranches,
      label: viewerBranchId,
    };
  }

  return {
    tenantId,
    mode: viewerCanViewAllBranches ? "ALL_BRANCHES" : "TENANT_FALLBACK",
    branchId: null,
    requestedBranchId: null,
    allowedBranchIds,
    canViewAllBranches: viewerCanViewAllBranches,
    label: viewerCanViewAllBranches ? "All branches" : "Tenant fallback",
  };
}

async function assertAssignmentsValidForViewer({ tenantId, req, assignments }) {
  const list = Array.isArray(assignments) ? assignments : [];
  if (!list.length) return [];

  const branchIds = Array.from(new Set(list.map((x) => x.branchId)));
  const allowedBranchIds = getAllowedBranchIds(req);
  const viewerCanViewAllBranches = canViewAllBranches(req);

  if (!viewerCanViewAllBranches && allowedBranchIds.length > 0) {
    const forbidden = branchIds.find((id) => !allowedBranchIds.includes(id));
    if (forbidden) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      err.branchId = forbidden;
      throw err;
    }
  }

  const branches = await prisma.branch.findMany({
    where: {
      tenantId,
      id: { in: branchIds },
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
      type: true,
    },
  });

  if (branches.length !== branchIds.length) {
    const found = new Set(branches.map((b) => b.id));
    const missing = branchIds.find((id) => !found.has(id));
    const err = new Error("One or more assigned branches were not found or are inactive");
    err.status = 400;
    err.branchId = missing || null;
    throw err;
  }

  return branches;
}

function publicAssignments(assignments = [], branchMap = new Map()) {
  return assignments.map((a) => ({
    id: a.id || null,
    branchId: a.branchId,
    isDefault: Boolean(a.isDefault),
    canOperate: Boolean(a.canOperate),
    canViewReports: Boolean(a.canViewReports),
    createdAt: a.createdAt || null,
    branch: branchMap.get(a.branchId) || null,
  }));
}

function buildPublicUser(user, branchMap = new Map()) {
  if (!user) return null;

  const assignments = Array.isArray(user.branchAssignments) ? user.branchAssignments : [];
  const defaultAssignment =
    assignments.find((a) => a.isDefault) || assignments[0] || null;

  return {
    id: user.id,
    tenantId: user.tenantId,
    defaultBranchId: defaultAssignment?.branchId || null,
    branchAssignments: publicAssignments(assignments, branchMap),
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    isActive: Boolean(user.isActive),
    createdAt: user.createdAt || null,
  };
}

function userMatchesScope(user, scope) {
  if (!user) return false;
  if (normalizeRole(user.role) === "OWNER") return true;
  if (scope.mode !== "SINGLE_BRANCH" || !scope.branchId) return true;

  const assignments = Array.isArray(user.branchAssignments) ? user.branchAssignments : [];
  return assignments.some((a) => a.branchId === scope.branchId);
}

async function replaceUserAssignmentsTx(tx, tenantId, userId, assignments) {
  await tx.userBranchAssignment.deleteMany({
    where: { tenantId, userId },
  });

  if (!assignments.length) return;

  await tx.userBranchAssignment.createMany({
    data: assignments.map((a) => ({
      tenantId,
      userId,
      branchId: a.branchId,
      isDefault: Boolean(a.isDefault),
      canOperate: Boolean(a.canOperate),
      canViewReports: Boolean(a.canViewReports),
    })),
  });
}

async function listUsers(req, res) {
  try {
    const scope = resolveUsersBranchScope(req);
    const tenantId = scope.tenantId;

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
        branchAssignments: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            branchId: true,
            isDefault: true,
            canOperate: true,
            canViewReports: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });

    const filtered = users.filter((u) => userMatchesScope(u, scope));
    const branchIds = Array.from(
      new Set(
        filtered.flatMap((u) =>
          (u.branchAssignments || []).map((a) => a.branchId).filter(Boolean)
        )
      )
    );
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.json({
      users: filtered.map((u) => buildPublicUser(u, branchMap)),
      employees: filtered.map((u) => buildPublicUser(u, branchMap)),
      branchScope: scope,
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
    const scope = resolveUsersBranchScope(req);
    const tenantId = scope.tenantId;
    const userId = cleanString(req.params?.id);

    if (!userId) {
      return res.status(400).json({ message: "User id is required" });
    }

    const user = await getUserOrThrow(tenantId, userId);

    if (!userMatchesScope(user, scope)) {
      return res.status(404).json({ message: "User not found" });
    }

    const branchIds = (user.branchAssignments || []).map((a) => a.branchId).filter(Boolean);
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.json({
      user: buildPublicUser(user, branchMap),
      employee: buildPublicUser(user, branchMap),
      branchScope: scope,
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

    const assignments = normalizeAssignmentsPayload(req, role, req.body || {});
    await assertAssignmentsValidForViewer({ tenantId, req, assignments });

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
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (role !== "OWNER") {
        await replaceUserAssignmentsTx(tx, tenantId, user.id, assignments);
      }

      return tx.user.findUnique({
        where: { id: user.id },
        select: {
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
              branchId: true,
              isDefault: true,
              canOperate: true,
              canViewReports: true,
              createdAt: true,
            },
          },
        },
      });
    });

    const branchIds = (created.branchAssignments || []).map((a) => a.branchId).filter(Boolean);
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.status(201).json({
      created: true,
      user: buildPublicUser(created, branchMap),
      employee: buildPublicUser(created, branchMap),
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

    const nextRole = role || existing.role;

    if (role) {
      await ensureSingleOwnerRule(tenantId, role, existing.id);
    }

    const assignmentsWereSent =
      Object.prototype.hasOwnProperty.call(req.body || {}, "branchAssignments") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "branchId");

    let assignments = (existing.branchAssignments || []).map((a) => ({
      branchId: a.branchId,
      isDefault: Boolean(a.isDefault),
      canOperate: Boolean(a.canOperate),
      canViewReports: Boolean(a.canViewReports),
    }));

    if (nextRole === "OWNER") {
      assignments = [];
    } else if (assignmentsWereSent || role !== undefined) {
      assignments = normalizeAssignmentsPayload(req, nextRole, {
        branchAssignments: assignmentsWereSent
          ? req.body?.branchAssignments
          : assignments.map((a) => ({
              branchId: a.branchId,
              isDefault: a.isDefault,
              canOperate: a.canOperate,
              canViewReports: a.canViewReports,
            })),
        branchId: assignmentsWereSent ? req.body?.branchId : undefined,
      });
      await assertAssignmentsValidForViewer({ tenantId, req, assignments });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(phone !== undefined ? { phone } : {}),
          ...(role !== undefined ? { role } : {}),
          ...(typeof isActive === "boolean" ? { isActive } : {}),
        },
      });

      if (nextRole === "OWNER" || assignmentsWereSent || role !== undefined) {
        await replaceUserAssignmentsTx(tx, tenantId, existing.id, assignments);
      }

      return tx.user.findUnique({
        where: { id: existing.id },
        select: {
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
              branchId: true,
              isDefault: true,
              canOperate: true,
              canViewReports: true,
              createdAt: true,
            },
          },
        },
      });
    });

    const branchIds = (updated.branchAssignments || []).map((a) => a.branchId).filter(Boolean);
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.json({
      updated: true,
      user: buildPublicUser(updated, branchMap),
      employee: buildPublicUser(updated, branchMap),
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
        branchAssignments: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            branchId: true,
            isDefault: true,
            canOperate: true,
            canViewReports: true,
            createdAt: true,
          },
        },
      },
    });

    const branchIds = (updated.branchAssignments || []).map((a) => a.branchId).filter(Boolean);
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.json({
      updated: true,
      user: buildPublicUser(updated, branchMap),
      employee: buildPublicUser(updated, branchMap),
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

    if (cleanString(req.user?.id || req.user?.userId) === existing.id) {
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
        branchAssignments: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          select: {
            id: true,
            branchId: true,
            isDefault: true,
            canOperate: true,
            canViewReports: true,
            createdAt: true,
          },
        },
      },
    });

    const branchIds = (updated.branchAssignments || []).map((a) => a.branchId).filter(Boolean);
    const branchMap = await getBranchMap(tenantId, branchIds);

    return res.json({
      deleted: true,
      user: buildPublicUser(updated, branchMap),
      employee: buildPublicUser(updated, branchMap),
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