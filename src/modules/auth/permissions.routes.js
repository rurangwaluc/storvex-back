// backend/src/modules/auth/permissions.routes.js
const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
} = require("../../middlewares/requireActiveSubscription");const requirePermission = require("../../middlewares/requirePermission");

const { PERMISSIONS, listRolePermissions, exportRolePermissions } = require("./permissions");

// Owner-only Settings area should be the one reading this
router.use(authenticate, requireTenant, requireActiveSubscription);

// who am I + my permissions
router.get("/me", (req, res) => {
  const role = req.user?.role || null;
  return res.json({
    role,
    permissions: listRolePermissions(role),
  });
});

// full policy map (only owner can view policy)
router.get(
  "/policy",
  requirePermission(PERMISSIONS.SETTINGS_VIEW),
  (req, res) => {
    return res.json({
      roles: exportRolePermissions(),
    });
  }
);

module.exports = router;