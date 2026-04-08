const {
  findAuditLogs,
  findAuditLogById,
  getAuditStats,
} = require("./audit.service");

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function listAuditLogs(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);

    const filters = {
      q: String(req.query.q || "").trim(),
      action: String(req.query.action || "").trim(),
      entity: String(req.query.entity || "").trim(),
      userId: String(req.query.userId || "").trim(),
      from: String(req.query.from || "").trim(),
      to: String(req.query.to || "").trim(),
    };

    const result = await findAuditLogs({
      tenantId,
      page,
      limit,
      filters,
    });

    return res.json({
      ok: true,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
      items: result.items,
    });
  } catch (err) {
    console.error("listAuditLogs error", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch audit logs",
    });
  }
}

async function getAuditLogById(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "Invalid audit log id",
      });
    }

    const item = await findAuditLogById({ tenantId, id });

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: "Audit log not found",
      });
    }

    return res.json({
      ok: true,
      item,
    });
  } catch (err) {
    console.error("getAuditLogById error", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch audit log",
    });
  }
}

async function getAuditLogStats(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const stats = await getAuditStats({ tenantId });

    return res.json({
      ok: true,
      stats,
    });
  } catch (err) {
    console.error("getAuditLogStats error", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch audit stats",
    });
  }
}

module.exports = {
  listAuditLogs,
  getAuditLogById,
  getAuditLogStats,
};