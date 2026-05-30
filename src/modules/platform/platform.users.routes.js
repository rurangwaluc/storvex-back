// backend/src/modules/platform/platform.users.routes.js
const express = require("express");
const router = express.Router();

const controller = require("./platform.users.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("./platform.auth.middleware");

const canViewPlatformUsers = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

const ownerOnly = requirePlatformRole("PLATFORM_OWNER");

/**
 * IMPORTANT:
 * Static routes must come before dynamic /:id routes.
 * Otherwise routes like /me/profile can be interpreted as id = "me".
 */

router.get(
  "/",
  requirePlatformAuth,
  canViewPlatformUsers,
  controller.listPlatformUsers
);

router.patch(
  "/me/profile",
  requirePlatformAuth,
  canViewPlatformUsers,
  controller.updateMyPlatformProfile
);

router.patch(
  "/me/password",
  requirePlatformAuth,
  canViewPlatformUsers,
  controller.changeMyPlatformPassword
);

router.get(
  "/:id",
  requirePlatformAuth,
  canViewPlatformUsers,
  controller.getPlatformUserById
);

router.post(
  "/",
  requirePlatformAuth,
  ownerOnly,
  controller.createPlatformUser
);

router.patch(
  "/:id/role",
  requirePlatformAuth,
  ownerOnly,
  controller.updatePlatformUserRole
);

router.patch(
  "/:id/status",
  requirePlatformAuth,
  ownerOnly,
  controller.updatePlatformUserStatus
);

router.patch(
  "/:id/password",
  requirePlatformAuth,
  ownerOnly,
  controller.resetPlatformUserPassword
);

module.exports = router;