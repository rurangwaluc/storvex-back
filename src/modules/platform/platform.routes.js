const express = require("express");
const router = express.Router();

const controller = require("./platform.controller");

const authenticate = require("../../middlewares/authenticate");
const requirePlatform = require("../../middlewares/requirePlatform");

// Dashboard KPIs
router.get(
  "/dashboard",
  authenticate,
  requirePlatform,
  controller.dashboard
);

// List all tenants
router.get(
  "/tenants",
  authenticate,
  requirePlatform,
  controller.listTenants
);
// Tenants info
router.get(
  "/tenants/:tenantId",
  authenticate,
  requirePlatform,
  controller.getTenantDetails
);

// Update tenant status (ACTIVE / SUSPENDED)
router.patch(
  "/tenants/:tenantId/status",
  authenticate,
  requirePlatform,
  controller.updateTenantStatus
);


// List subscriptions
router.get(
  "/subscriptions",
  authenticate,
  requirePlatform,
  controller.listSubscriptions
);

// List owner intents
router.get(
  "/intents",
  authenticate,
  requirePlatform,
  controller.listOwnerIntents
);

module.exports = router;
