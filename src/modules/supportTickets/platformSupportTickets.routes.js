const express = require("express");

const controller = require("./platformSupportTickets.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("../platform/platform.auth.middleware");

const router = express.Router();

const canViewSupportTickets = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

const canManageSupportTickets = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

router.get(
  "/overview",
  requirePlatformAuth,
  canViewSupportTickets,
  controller.getPlatformSupportTicketsOverview
);

router.get(
  "/",
  requirePlatformAuth,
  canViewSupportTickets,
  controller.listPlatformSupportTickets
);

router.get(
  "/:id",
  requirePlatformAuth,
  canViewSupportTickets,
  controller.getPlatformSupportTicketById
);

router.post(
  "/:id/reply",
  requirePlatformAuth,
  canManageSupportTickets,
  controller.replyToPlatformSupportTicket
);

router.patch(
  "/:id/status",
  requirePlatformAuth,
  canManageSupportTickets,
  controller.updatePlatformSupportTicketStatus
);

router.patch(
  "/:id/assign",
  requirePlatformAuth,
  canManageSupportTickets,
  controller.assignPlatformSupportTicket
);

module.exports = router;