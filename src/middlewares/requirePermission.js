// backend/src/middlewares/requirePermission.js
const { roleHas } = require("../modules/auth/permissions");

module.exports = function requirePermission(permissionOrList) {
  const required = Array.isArray(permissionOrList) ? permissionOrList : [permissionOrList];

  return function (req, res, next) {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ message: "Unauthorized" });

    const ok = required.some((p) => roleHas(role, p));
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