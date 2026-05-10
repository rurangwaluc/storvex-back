// backend/src/modules/audit/audit.service.js
const prisma = require("../../config/database");

const AUDIT_ROLES_ALLOWED_TO_VIEW = new Set(["OWNER", "MANAGER"]);

function cleanString(value) {
  const s = String(value || "").trim();
  return s || "";
}

function normalizeRole(value) {
  return cleanString(value).toUpperCase();
}

function safeDate(value, endOfDay = false) {
  if (!value) return null;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  }

  return d;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;

  const v = cleanString(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return true;
  if (["false", "0", "no", "n"].includes(v)) return false;

  return null;
}

function serializeBranch(branch) {
  if (!branch) return null;

  return {
    id: branch.id,
    tenantId: branch.tenantId,
    name: branch.name || "",
    code: branch.code || "",
    type: branch.type || "",
    status: branch.status || "",
    district: branch.district || "",
    sector: branch.sector || "",
    address: branch.address || "",
    isMain: Boolean(branch.isMain),
  };
}

function serializeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    role: user.role || "",
  };
}

function mapAuditListItem(log) {
  return {
    id: log.id,
    tenantId: log.tenantId,
    branchId: log.branchId || null,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId || "",
    createdAt: log.createdAt,
    metadata: log.metadata || null,
    user: serializeUser(log.user),
    branch: serializeBranch(log.branch),
    scope: log.branchId ? "BRANCH" : "WORKSPACE",
  };
}

function mapAuditDetailItem(log) {
  return {
    id: log.id,
    tenantId: log.tenantId,
    branchId: log.branchId || null,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId || "",
    createdAt: log.createdAt,
    metadata: log.metadata || null,
    user: serializeUser(log.user),
    branch: serializeBranch(log.branch),
    scope: log.branchId ? "BRANCH" : "WORKSPACE",
  };
}

async function getViewerBranchAccess({ tenantId, userId, role }) {
  const normalizedRole = normalizeRole(role);

  if (!AUDIT_ROLES_ALLOWED_TO_VIEW.has(normalizedRole)) {
    return {
      canViewAudit: false,
      canViewAllBranches: false,
      allowedBranchIds: [],
      role: normalizedRole,
    };
  }

  if (normalizedRole === "OWNER") {
    return {
      canViewAudit: true,
      canViewAllBranches: true,
      allowedBranchIds: [],
      role: normalizedRole,
    };
  }

  const assignments = await prisma.userBranchAssignment.findMany({
    where: {
      tenantId,
      userId,
    },
    select: {
      branchId: true,
      canViewReports: true,
      canOperate: true,
      branch: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  const allowedBranchIds = assignments
    .filter((assignment) => assignment.branch?.status !== "DELETED")
    .filter((assignment) => assignment.canViewReports || assignment.canOperate)
    .map((assignment) => assignment.branchId)
    .filter(Boolean);

  return {
    canViewAudit: true,
    canViewAllBranches: false,
    allowedBranchIds,
    role: normalizedRole,
  };
}

function buildNoAccessWhere() {
  return {
    branchId: "__NO_BRANCH_ACCESS__",
  };
}

function buildBranchWhereForViewer({ access, requestedBranchId, includeWorkspaceWide }) {
  const cleanRequestedBranchId = cleanString(requestedBranchId);

  if (access.canViewAllBranches) {
    if (cleanRequestedBranchId === "__WORKSPACE__") {
      return { branchId: null };
    }

    if (cleanRequestedBranchId) {
      return { branchId: cleanRequestedBranchId };
    }

    return {};
  }

  const allowedBranchIds = Array.isArray(access.allowedBranchIds) ? access.allowedBranchIds : [];

  if (!allowedBranchIds.length) {
    return includeWorkspaceWide ? { branchId: null } : buildNoAccessWhere();
  }

  if (cleanRequestedBranchId === "__WORKSPACE__") {
    return includeWorkspaceWide ? { branchId: null } : buildNoAccessWhere();
  }

  if (cleanRequestedBranchId) {
    if (!allowedBranchIds.includes(cleanRequestedBranchId)) {
      return buildNoAccessWhere();
    }

    return {
      branchId: cleanRequestedBranchId,
    };
  }

  if (includeWorkspaceWide) {
    return {
      OR: [{ branchId: { in: allowedBranchIds } }, { branchId: null }],
    };
  }

  return {
    branchId: {
      in: allowedBranchIds,
    },
  };
}

function mergeSearchWhere(where, searchOr) {
  if (!Array.isArray(searchOr) || !searchOr.length) return where;

  if (where.OR) {
    return {
      ...where,
      AND: [{ OR: where.OR }, { OR: searchOr }],
      OR: undefined,
    };
  }

  return {
    ...where,
    OR: searchOr,
  };
}

function buildWhere({ tenantId, filters, access }) {
  const q = cleanString(filters?.q);
  const action = cleanString(filters?.action).toUpperCase();
  const entity = cleanString(filters?.entity).toUpperCase();
  const userId = cleanString(filters?.userId);
  const requestedBranchId = cleanString(filters?.branchId);

  const includeWorkspaceWide = normalizeBoolean(filters?.includeWorkspaceWide) !== false;

  const fromDate = safeDate(filters?.from);
  const toDate = safeDate(filters?.to, true);

  let where = {
    tenantId,
  };

  const branchWhere = buildBranchWhereForViewer({
    access,
    requestedBranchId,
    includeWorkspaceWide,
  });

  where = {
    ...where,
    ...branchWhere,
  };

  if (action) {
    where.action = action;
  }

  if (entity) {
    where.entity = entity;
  }

  if (userId) {
    where.userId = userId;
  }

  if (fromDate || toDate) {
    where.createdAt = {};

    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  if (q) {
    const searchOr = [
      { entityId: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
      { branch: { code: { contains: q, mode: "insensitive" } } },
    ];

    where = mergeSearchWhere(where, searchOr);

    if (where.OR === undefined) {
      delete where.OR;
    }
  }

  return where;
}

function auditInclude() {
  return {
    user: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    },
    branch: {
      select: {
        id: true,
        tenantId: true,
        name: true,
        code: true,
        type: true,
        status: true,
        district: true,
        sector: true,
        address: true,
        isMain: true,
      },
    },
  };
}

function publicViewerAccess(access) {
  return {
    role: access.role,
    canViewAllBranches: Boolean(access.canViewAllBranches),
    allowedBranchIds: Array.isArray(access.allowedBranchIds) ? access.allowedBranchIds : [],
  };
}

async function findAuditLogs({ tenantId, viewerUserId, viewerRole, page, limit, filters }) {
  const access = await getViewerBranchAccess({
    tenantId,
    userId: viewerUserId,
    role: viewerRole,
  });

  if (!access.canViewAudit) {
    const err = new Error("You do not have permission to view audit logs");
    err.status = 403;
    throw err;
  }

  const safePage = toPositiveInt(page, 1);
  const safeLimit = Math.min(toPositiveInt(limit, 20), 100);
  const skip = (safePage - 1) * safeLimit;

  const where = buildWhere({
    tenantId,
    filters: filters || {},
    access,
  });

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safeLimit,
      include: auditInclude(),
    }),
  ]);

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    hasNextPage: skip + logs.length < total,
    hasPrevPage: safePage > 1,
    viewerAccess: publicViewerAccess(access),
    items: logs.map(mapAuditListItem),
  };
}

async function findAuditLogById({ tenantId, viewerUserId, viewerRole, id }) {
  const cleanId = cleanString(id);

  const access = await getViewerBranchAccess({
    tenantId,
    userId: viewerUserId,
    role: viewerRole,
  });

  if (!access.canViewAudit) {
    const err = new Error("You do not have permission to view audit logs");
    err.status = 403;
    throw err;
  }

  if (!cleanId) return null;

  const where = {
    tenantId,
    id: cleanId,
  };

  const branchWhere = buildBranchWhereForViewer({
    access,
    requestedBranchId: "",
    includeWorkspaceWide: true,
  });

  Object.assign(where, branchWhere);

  const log = await prisma.auditLog.findFirst({
    where,
    include: auditInclude(),
  });

  return log ? mapAuditDetailItem(log) : null;
}

async function getAuditStats({ tenantId, viewerUserId, viewerRole, filters = {} }) {
  const access = await getViewerBranchAccess({
    tenantId,
    userId: viewerUserId,
    role: viewerRole,
  });

  if (!access.canViewAudit) {
    const err = new Error("You do not have permission to view audit logs");
    err.status = 403;
    throw err;
  }

  const baseWhere = buildWhere({
    tenantId,
    filters,
    access,
  });

  const now = Date.now();

  const [total, last24h, last7d, workspaceWide, byEntity, byAction, byBranch] =
    await Promise.all([
      prisma.auditLog.count({
        where: baseWhere,
      }),

      prisma.auditLog.count({
        where: {
          ...baseWhere,
          createdAt: {
            gte: new Date(now - 24 * 60 * 60 * 1000),
          },
        },
      }),

      prisma.auditLog.count({
        where: {
          ...baseWhere,
          createdAt: {
            gte: new Date(now - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),

      prisma.auditLog.count({
        where: {
          ...baseWhere,
          branchId: null,
        },
      }),

      prisma.auditLog.groupBy({
        by: ["entity"],
        where: baseWhere,
        _count: {
          entity: true,
        },
        orderBy: {
          _count: {
            entity: "desc",
          },
        },
        take: 10,
      }),

      prisma.auditLog.groupBy({
        by: ["action"],
        where: baseWhere,
        _count: {
          action: true,
        },
        orderBy: {
          _count: {
            action: "desc",
          },
        },
        take: 10,
      }),

      prisma.auditLog.groupBy({
        by: ["branchId"],
        where: baseWhere,
        _count: {
          _all: true,
        },
        orderBy: {
          _count: {
            branchId: "desc",
          },
        },
        take: 10,
      }),
    ]);

  const branchIds = byBranch.map((row) => row.branchId).filter(Boolean);

  const branches = branchIds.length
    ? await prisma.branch.findMany({
        where: {
          tenantId,
          id: {
            in: branchIds,
          },
        },
        select: {
          id: true,
          tenantId: true,
          name: true,
          code: true,
          type: true,
          status: true,
          district: true,
          sector: true,
          address: true,
          isMain: true,
        },
      })
    : [];

  const branchMap = new Map(branches.map((branch) => [branch.id, branch]));

  return {
    total,
    last24h,
    last7d,
    workspaceWide,
    viewerAccess: publicViewerAccess(access),
    topEntities: byEntity.map((row) => ({
      entity: row.entity,
      count: row._count.entity,
    })),
    topActions: byAction.map((row) => ({
      action: row.action,
      count: row._count.action,
    })),
    topBranches: byBranch.map((row) => {
      const branch = row.branchId ? branchMap.get(row.branchId) : null;

      return {
        branchId: row.branchId || null,
        branch: serializeBranch(branch),
        count: row._count._all,
        scope: row.branchId ? "BRANCH" : "WORKSPACE",
      };
    }),
  };
}

async function listAuditBranches({ tenantId, viewerUserId, viewerRole }) {
  const access = await getViewerBranchAccess({
    tenantId,
    userId: viewerUserId,
    role: viewerRole,
  });

  if (!access.canViewAudit) {
    const err = new Error("You do not have permission to view audit logs");
    err.status = 403;
    throw err;
  }

  const where = {
    tenantId,
  };

  if (!access.canViewAllBranches) {
    if (!access.allowedBranchIds.length) {
      return {
        branches: [],
        viewerAccess: publicViewerAccess(access),
      };
    }

    where.id = {
      in: access.allowedBranchIds,
    };
  }

  const branches = await prisma.branch.findMany({
    where,
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      type: true,
      status: true,
      district: true,
      sector: true,
      address: true,
      isMain: true,
    },
  });

  return {
    branches: branches.map(serializeBranch).filter(Boolean),
    viewerAccess: publicViewerAccess(access),
  };
}

module.exports = {
  findAuditLogs,
  findAuditLogById,
  getAuditStats,
  listAuditBranches,
};