const { resolveEffectiveDbPermissions } = require("../modules/auth/dbPermissions.service");

module.exports = function requireDbPermission(permissionOrList) {
  const required = Array.isArray(permissionOrList) ? permissionOrList : [permissionOrList];

  return async function (req, res, next) {
    try {
      const role = req.user?.role;
      const userId = req.user?.userId || req.user?.id;
      const tenantId = req.user?.tenantId;

      if (!role || !userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (!req.dbPermissions) {
        req.dbPermissions = await resolveEffectiveDbPermissions({
          userId,
          role,
        });
      }

      const ok = required.some((permission) => req.dbPermissions.includes(permission));

      if (!ok) {
        return res.status(403).json({
          message: "Forbidden",
          required,
          role,
        });
      }

      return next();
    } catch (err) {
      console.error("requireDbPermission error:", {
        required,
        role: req.user?.role,
        userId: req.user?.userId || req.user?.id,
        tenantId: req.user?.tenantId,
        message: err?.message,
        code: err?.code,
        stack: err?.stack,
      });

      return res.status(500).json({ message: "Failed to verify permissions" });
    }
  };
};