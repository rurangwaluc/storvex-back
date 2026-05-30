function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

module.exports = function requirePlatformRole(...allowedRoles) {
  const allowed = allowedRoles.map(normalizeRole).filter(Boolean);

  return function platformRoleGuard(req, res, next) {
    const role = normalizeRole(req.platformUser?.role || req.user?.role);

    if (!role) {
      return res.status(403).json({
        message: "Platform role missing",
        code: "PLATFORM_ROLE_MISSING",
      });
    }

    if (allowed.length > 0 && !allowed.includes(role)) {
      return res.status(403).json({
        message: "Insufficient platform privileges",
        code: "PLATFORM_ROLE_FORBIDDEN",
      });
    }

    return next();
  };
};