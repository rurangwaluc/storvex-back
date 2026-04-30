// src/modules/store/store.routes.js
const express = require("express");

const router = express.Router();

const controller = require("./store.controller");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const {
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const { PERMISSIONS } = require("../auth/permissions");

// NOTE:
// /api/store is already mounted in app.js behind:
// authenticate, requireTenant, requireActiveSubscription, and store-role gating.
// So this route file should focus on endpoint-level permission checks only.

// Read endpoints
router.get(
  "/profile",
  requireDbPermission(PERMISSIONS.SETTINGS_VIEW),
  controller.getProfile
);

router.get(
  "/setup-checklist",
  requireDbPermission(PERMISSIONS.SETTINGS_VIEW),
  controller.getChecklist
);

router.get(
  "/document-settings",
  requireDbPermission(PERMISSIONS.SETTINGS_VIEW),
  controller.getDocumentConfig
);

// Write endpoints
router.patch(
  "/profile",
  express.json(),
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.SETTINGS_EDIT_GENERAL),
  controller.patchProfile
);

router.patch(
  "/document-settings",
  express.json(),
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.SETTINGS_EDIT_GENERAL),
  controller.patchDocumentConfig
);

router.post(
  "/logo-upload-url",
  express.json(),
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.SETTINGS_EDIT_GENERAL),
  controller.createLogoUploadUrl
);

module.exports = router;