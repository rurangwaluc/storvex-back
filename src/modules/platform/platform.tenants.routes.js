const express = require("express");
const router = express.Router();

const controller = require("./platform.tenants.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("./platform.auth.middleware");

const canViewPlatform = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

const canControlTenants = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN"
);

const ownerOnly = requirePlatformRole("PLATFORM_OWNER");

router.get(
  "/overview",
  requirePlatformAuth,
  canViewPlatform,
  controller.getPlatformOverview
);

router.get(
  "/",
  requirePlatformAuth,
  canViewPlatform,
  controller.listTenants
);

router.get(
  "/:id",
  requirePlatformAuth,
  canViewPlatform,
  controller.getTenantDetail
);

router.patch(
  "/:id/status",
  requirePlatformAuth,
  canControlTenants,
  controller.updateTenantStatus
);

router.patch(
  "/:id/subscription/access-mode",
  requirePlatformAuth,
  canControlTenants,
  controller.updateSubscriptionAccess
);

router.post(
  "/:id/repair-owner",
  requirePlatformAuth,
  ownerOnly,
  controller.repairMissingOwner
);

module.exports = router;