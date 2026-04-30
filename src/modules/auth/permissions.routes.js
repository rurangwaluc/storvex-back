// backend/src/modules/auth/permissions.routes.js
const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requirePermission = require("../../middlewares/requirePermission");

const {
  PERMISSIONS,
  listRolePermissions,
  exportRolePermissions,
} = require("./permissions");

// Settings / permission policy area
router.use(authenticate, requireTenant, requireActiveSubscription);

// who am I + my permissions
router.get("/me", (req, res) => {
  const role = req.user?.role || null;

  return res.json({
    role,
    permissions: listRolePermissions(role),
  });
});

// full permission catalog + role policy map
// Owner-only
router.get(
  "/policy",
  requirePermission(PERMISSIONS.BILLING_VIEW),
  (req, res) => {
    const role = String(req.user?.role || "").trim().toUpperCase();

    if (role !== "OWNER" && role !== "PLATFORM_ADMIN") {
      return res.status(403).json({
        message: "Forbidden",
      });
    }

    return res.json({
      permissions: Object.values(PERMISSIONS),
      roles: exportRolePermissions(),
    });
  }
);

module.exports = router;