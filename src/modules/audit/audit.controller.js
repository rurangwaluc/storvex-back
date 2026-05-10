const {
  findAuditLogs,
  findAuditLogById,
  getAuditStats,
  listAuditBranches,
} = require("./audit.service");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || "";
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getTenantId(req) {
  return cleanString(req.user?.tenantId || req.tenantId);
}

function getViewerUserId(req) {
  return cleanString(req.user?.id || req.user?.userId);
}

function getViewerRole(req) {
  return cleanString(req.user?.role);
}

function getFilters(req) {
  return {
    q: cleanString(req.query?.q),
    action: cleanString(req.query?.action),
    entity: cleanString(req.query?.entity),
    userId: cleanString(req.query?.userId),
    branchId: cleanString(req.query?.branchId),
    includeWorkspaceWide: req.query?.includeWorkspaceWide,
    from: cleanString(req.query?.from),
    to: cleanString(req.query?.to),
  };
}

async function listAuditLogs(req, res) {
  try {
    const tenantId = getTenantId(req);
    const viewerUserId = getViewerUserId(req);
    const viewerRole = getViewerRole(req);

    if (!tenantId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const page = toPositiveInt(req.query?.page, 1);
    const limit = Math.min(toPositiveInt(req.query?.limit, 20), 100);

    const result = await findAuditLogs({
      tenantId,
      viewerUserId,
      viewerRole,
      page,
      limit,
      filters: getFilters(req),
    });

    return res.json({
      ok: true,
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
      viewerAccess: result.viewerAccess,
      items: result.items,
    });
  } catch (err) {
    console.error("listAuditLogs error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to fetch audit logs",
    });
  }
}

async function getAuditLogById(req, res) {
  try {
    const tenantId = getTenantId(req);
    const viewerUserId = getViewerUserId(req);
    const viewerRole = getViewerRole(req);
    const id = cleanString(req.params?.id);

    if (!tenantId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    if (!id) {
      return res.status(400).json({
        ok: false,
        message: "Invalid audit log id",
      });
    }

    const item = await findAuditLogById({
      tenantId,
      viewerUserId,
      viewerRole,
      id,
    });

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
    console.error("getAuditLogById error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to fetch audit log",
    });
  }
}

async function getAuditLogStats(req, res) {
  try {
    const tenantId = getTenantId(req);
    const viewerUserId = getViewerUserId(req);
    const viewerRole = getViewerRole(req);

    if (!tenantId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const stats = await getAuditStats({
      tenantId,
      viewerUserId,
      viewerRole,
      filters: getFilters(req),
    });

    return res.json({
      ok: true,
      stats,
    });
  } catch (err) {
    console.error("getAuditLogStats error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to fetch audit stats",
    });
  }
}

async function getAuditBranches(req, res) {
  try {
    const tenantId = getTenantId(req);
    const viewerUserId = getViewerUserId(req);
    const viewerRole = getViewerRole(req);

    if (!tenantId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const result = await listAuditBranches({
      tenantId,
      viewerUserId,
      viewerRole,
    });

    return res.json({
      ok: true,
      branches: result.branches,
      viewerAccess: result.viewerAccess,
    });
  } catch (err) {
    console.error("getAuditBranches error:", err);

    return res.status(err.status || 500).json({
      ok: false,
      message: err.message || "Failed to fetch audit branches",
    });
  }
}

module.exports = {
  listAuditLogs,
  getAuditLogById,
  getAuditLogStats,
  getAuditBranches,
};