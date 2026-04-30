// backend/src/middlewares/requirePermission.js
const { roleHas } = require("../modules/auth/permissions");

module.exports = function requirePermission(permissionOrList) {
  const required = Array.isArray(permissionOrList) ? permissionOrList : [permissionOrList];

  return function (req, res, next) {
    const role = String(req.user?.role || "").trim().toUpperCase();

    if (!role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const ok = required.some((permission) => roleHas(role, permission));

    if (!ok) {
      return res.status(403).json({
        message: "Forbidden",
        required,
        role,
      });
    }

    return next();
  };
};