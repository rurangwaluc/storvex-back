"use strict";

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function getRequestRoles(req) {
  const roles = [];

  const singleRole = normalizeRole(req.user?.role);
  if (singleRole) roles.push(singleRole);

  if (Array.isArray(req.user?.roles)) {
    for (const role of req.user.roles) {
      const normalized = normalizeRole(role);
      if (normalized) roles.push(normalized);
    }
  }

  return [...new Set(roles)];
}

module.exports = (...allowedRoles) => {
  const allowed = allowedRoles.map(normalizeRole).filter(Boolean);

  return (req, res, next) => {
    const userRoles = getRequestRoles(req);

    if (!userRoles.length) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "ROLE_MISSING",
      });
    }

    const allowedSet = new Set(allowed);
    const hasAccess = userRoles.some((role) => allowedSet.has(role));

    if (!hasAccess) {
      return res.status(403).json({
        message: "Forbidden",
        code: "ROLE_FORBIDDEN",
        requiredRoles: allowed,
        currentRoles: userRoles,
      });
    }

    return next();
  };
};