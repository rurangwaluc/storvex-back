const express = require("express");
const router = express.Router();

const controller = require("./platform.support.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("./platform.auth.middleware");

const canUseSupport = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

router.get(
  "/overview",
  requirePlatformAuth,
  canUseSupport,
  controller.getSupportOverview
);

router.get(
  "/businesses",
  requirePlatformAuth,
  canUseSupport,
  controller.searchBusinesses
);

router.get(
  "/businesses/:tenantId",
  requirePlatformAuth,
  canUseSupport,
  controller.getBusinessSupportDetail
);

router.get(
  "/businesses/:tenantId/account-health",
  requirePlatformAuth,
  canUseSupport,
  controller.getBusinessAccountHealth
);

router.get(
  "/businesses/:tenantId/activity",
  requirePlatformAuth,
  canUseSupport,
  controller.getBusinessActivity
);

module.exports = router;