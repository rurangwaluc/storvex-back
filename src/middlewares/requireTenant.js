module.exports = function requireTenant(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  // Tenant users MUST have a tenantId
  if (!req.user.tenantId) {
    return res.status(403).json({
      message: "Tenant access only",
    });
  }

  next();
};
