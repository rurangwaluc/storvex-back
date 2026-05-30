const express = require("express");
const router = express.Router();

const controller = require("./platform.audit.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("./platform.auth.middleware");

const canViewPlatformAudit = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

router.get(
  "/overview",
  requirePlatformAuth,
  canViewPlatformAudit,
  controller.getPlatformAuditOverview
);

router.get(
  "/",
  requirePlatformAuth,
  canViewPlatformAudit,
  controller.listPlatformAuditLogs
);

router.get(
  "/:id",
  requirePlatformAuth,
  canViewPlatformAudit,
  controller.getPlatformAuditLogById
);

module.exports = router;