const prisma = require("../../config/database");
const { AuditAction, AuditEntity } = require("@prisma/client");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getPlatformUser(req) {
  return req.platformUser || req.user || null;
}

function getPlatformRole(req) {
  return String(getPlatformUser(req)?.role || "").toUpperCase();
}

function canViewPlatformAudit(req) {
  const role = getPlatformRole(req);
  return (
    role === "PLATFORM_OWNER" ||
    role === "PLATFORM_ADMIN" ||
    role === "PLATFORM_SUPPORT"
  );
}

function normalizeAuditAction(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(AuditAction).includes(raw) ? raw : null;
}

function normalizeAuditEntity(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(AuditEntity).includes(raw) ? raw : null;
}

function parseDate(value) {
  const raw = cleanString(value);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function normalizeTake(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 100);
}

function normalizeSkip(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(Math.trunc(n), 0);
}

function auditLogSelect() {
  return {
    id: true,
    tenantId: true,
    branchId: true,
    userId: true,
    entityId: true,
    action: true,
    entity: true,
    metadata: true,
    createdAt: true,

    tenant: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        shopType: true,
        district: true,
        sector: true,
      },
    },

    branch: {
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        status: true,
        isMain: true,
      },
    },

    user: {
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
      },
    },
  };
}

function publicAuditLog(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    storeLocationId: row.branchId || null,
    userId: row.userId || null,
    entityId: row.entityId || null,
    action: row.action,
    entity: row.entity,
    metadata: row.metadata || null,
    createdAt: row.createdAt,

    business: row.tenant
      ? {
          id: row.tenant.id,
          name: row.tenant.name,
          email: row.tenant.email,
          phone: row.tenant.phone,
          status: row.tenant.status,
          shopType: row.tenant.shopType || null,
          district: row.tenant.district || null,
          sector: row.tenant.sector || null,
        }
      : null,

    storeLocation: row.branch
      ? {
          id: row.branch.id,
          name: row.branch.name,
          code: row.branch.code,
          type: row.branch.type,
          status: row.branch.status,
          isMain: Boolean(row.branch.isMain),
        }
      : null,

    actor: row.user
      ? {
          id: row.user.id,
          tenantId: row.user.tenantId,
          name: row.user.name,
          email: row.user.email,
          phone: row.user.phone,
          role: row.user.role,
          isActive: Boolean(row.user.isActive),
        }
      : null,
  };
}

function buildAuditWhere(req) {
  const tenantId = cleanString(req.query?.tenantId);
  const branchId =
    cleanString(req.query?.storeLocationId) ||
    cleanString(req.query?.branchId);

  const userId = cleanString(req.query?.userId);
  const entityId = cleanString(req.query?.entityId);

  const action = normalizeAuditAction(req.query?.action);
  const entity = normalizeAuditEntity(req.query?.entity);

  const from = parseDate(req.query?.from);
  const to = parseDate(req.query?.to);

  const q = cleanString(req.query?.q);

  const where = {
    ...(tenantId ? { tenantId } : {}),
    ...(branchId ? { branchId } : {}),
    ...(userId ? { userId } : {}),
    ...(entityId ? { entityId } : {}),
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
  };

  if (q) {
    where.OR = [
      {
        tenant: {
          name: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        tenant: {
          email: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        tenant: {
          phone: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        user: {
          name: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        user: {
          email: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        branch: {
          name: {
            contains: q,
            mode: "insensitive",
          },
        },
      },
      {
        entityId: {
          contains: q,
          mode: "insensitive",
        },
      },
    ];
  }

  return where;
}

async function listPlatformAuditLogs(req, res) {
  if (!canViewPlatformAudit(req)) {
    return res.status(403).json({
      message: "Platform access denied",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  try {
    const skip = normalizeSkip(req.query?.skip, 0);
    const take = normalizeTake(req.query?.take, 50);
    const where = buildAuditWhere(req);

    const [rows, count] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: auditLogSelect(),
      }),
      prisma.auditLog.count({ where }),
    ]);

    const auditLogs = rows.map(publicAuditLog);

    return res.json({
      auditLogs,
      count,
      page: {
        skip,
        take,
        returned: auditLogs.length,
        hasMore: skip + auditLogs.length < count,
      },
    });
  } catch (err) {
    console.error("listPlatformAuditLogs error:", err);

    return res.status(500).json({
      message: "Failed to load platform audit logs",
      code: "PLATFORM_AUDIT_LIST_FAILED",
    });
  }
}

async function getPlatformAuditLogById(req, res) {
  if (!canViewPlatformAudit(req)) {
    return res.status(403).json({
      message: "Platform access denied",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  const id = cleanString(req.params?.id);

  if (!id) {
    return res.status(400).json({
      message: "Audit log id is required",
      code: "AUDIT_LOG_ID_REQUIRED",
    });
  }

  try {
    const row = await prisma.auditLog.findFirst({
      where: { id },
      select: auditLogSelect(),
    });

    if (!row) {
      return res.status(404).json({
        message: "Audit log not found",
        code: "AUDIT_LOG_NOT_FOUND",
      });
    }

    return res.json({
      auditLog: publicAuditLog(row),
    });
  } catch (err) {
    console.error("getPlatformAuditLogById error:", err);

    return res.status(500).json({
      message: "Failed to load audit log",
      code: "PLATFORM_AUDIT_DETAIL_FAILED",
    });
  }
}

async function getPlatformAuditOverview(req, res) {
  if (!canViewPlatformAudit(req)) {
    return res.status(403).json({
      message: "Platform access denied",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      total,
      last24Hours,
      last7Days,
      last30Days,
      byEntity,
      byAction,
      mostActiveBusinesses,
      recentLogs,
    ] = await Promise.all([
      prisma.auditLog.count(),

      prisma.auditLog.count({
        where: { createdAt: { gte: last24h } },
      }),

      prisma.auditLog.count({
        where: { createdAt: { gte: last7d } },
      }),

      prisma.auditLog.count({
        where: { createdAt: { gte: last30d } },
      }),

      prisma.auditLog.groupBy({
        by: ["entity"],
        _count: { _all: true },
        orderBy: {
          _count: {
            entity: "desc",
          },
        },
      }),

      prisma.auditLog.groupBy({
        by: ["action"],
        _count: { _all: true },
        orderBy: {
          _count: {
            action: "desc",
          },
        },
        take: 15,
      }),

      prisma.auditLog.groupBy({
        by: ["tenantId"],
        _count: { _all: true },
        orderBy: {
          _count: {
            tenantId: "desc",
          },
        },
        take: 10,
      }),

      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: auditLogSelect(),
      }),
    ]);

    const tenantIds = mostActiveBusinesses
      .map((row) => row.tenantId)
      .filter(Boolean);

    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
          },
        })
      : [];

    const tenantMap = new Map(tenants.map((tenant) => [tenant.id, tenant]));

    return res.json({
      overview: {
        total,
        last24Hours,
        last7Days,
        last30Days,
        byEntity: byEntity.map((row) => ({
          entity: row.entity,
          count: safeNumber(row._count?._all),
        })),
        byAction: byAction.map((row) => ({
          action: row.action,
          count: safeNumber(row._count?._all),
        })),
        mostActiveBusinesses: mostActiveBusinesses.map((row) => ({
          business: tenantMap.get(row.tenantId) || {
            id: row.tenantId,
            name: "Unknown business",
            email: null,
            phone: null,
            status: null,
          },
          count: safeNumber(row._count?._all),
        })),
        recentLogs: recentLogs.map(publicAuditLog),
      },
    });
  } catch (err) {
    console.error("getPlatformAuditOverview error:", err);

    return res.status(500).json({
      message: "Failed to load platform audit overview",
      code: "PLATFORM_AUDIT_OVERVIEW_FAILED",
    });
  }
}

module.exports = {
  listPlatformAuditLogs,
  getPlatformAuditLogById,
  getPlatformAuditOverview,
};