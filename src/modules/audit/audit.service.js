const prisma = require("../../config/database");

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildWhere({ tenantId, filters }) {
  const where = {
    tenantId,
  };

  if (filters.action) {
    where.action = filters.action;
  }

  if (filters.entity) {
    where.entity = filters.entity;
  }

  if (filters.userId) {
    where.userId = filters.userId;
  }

  const fromDate = safeDate(filters.from);
  const toDate = safeDate(filters.to);

  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) where.createdAt.gte = fromDate;
    if (toDate) where.createdAt.lte = toDate;
  }

  if (filters.q) {
    where.OR = [
      { entityId: { contains: filters.q, mode: "insensitive" } },
      { user: { name: { contains: filters.q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function mapAuditListItem(log) {
  return {
    id: log.id,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId || "",
    createdAt: log.createdAt,
    metadata: log.metadata || null,
    user: log.user
      ? {
          id: log.user.id,
          name: log.user.name || "",
          role: log.user.role || "",
        }
      : null,
  };
}

function mapAuditDetailItem(log) {
  return {
    id: log.id,
    tenantId: log.tenantId,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId || "",
    createdAt: log.createdAt,
    metadata: log.metadata || null,
    user: log.user
      ? {
          id: log.user.id,
          name: log.user.name || "",
          role: log.user.role || "",
          email: log.user.email || "",
        }
      : null,
  };
}

async function findAuditLogs({ tenantId, page, limit, filters }) {
  const where = buildWhere({ tenantId, filters });
  const skip = (page - 1) * limit;

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    hasNextPage: skip + logs.length < total,
    hasPrevPage: page > 1,
    items: logs.map(mapAuditListItem),
  };
}

async function findAuditLogById({ tenantId, id }) {
  const log = await prisma.auditLog.findFirst({
    where: {
      id,
      tenantId,
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          email: true,
        },
      },
    },
  });

  return log ? mapAuditDetailItem(log) : null;
}

async function getAuditStats({ tenantId }) {
  const now = Date.now();

  const [total, last24h, last7d, byEntity, byAction] = await Promise.all([
    prisma.auditLog.count({
      where: { tenantId },
    }),
    prisma.auditLog.count({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(now - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.auditLog.count({
      where: {
        tenantId,
        createdAt: {
          gte: new Date(now - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.auditLog.groupBy({
      by: ["entity"],
      where: { tenantId },
      _count: { entity: true },
      orderBy: {
        _count: {
          entity: "desc",
        },
      },
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { tenantId },
      _count: { action: true },
      orderBy: {
        _count: {
          action: "desc",
        },
      },
    }),
  ]);

  return {
    total,
    last24h,
    last7d,
    topEntities: byEntity.map((x) => ({
      entity: x.entity,
      count: x._count.entity,
    })),
    topActions: byAction.map((x) => ({
      action: x.action,
      count: x._count.action,
    })),
  };
}

module.exports = {
  findAuditLogs,
  findAuditLogById,
  getAuditStats,
};