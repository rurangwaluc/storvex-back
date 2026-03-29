// src/modules/store/store.routes.js
const express = require("express");

const router = express.Router();

const controller = require("./store.controller");
const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

// All store routes are authenticated + tenant scoped.
router.use(authenticate, requireTenant, requireActiveSubscription);

// Read endpoints
router.get(
  "/profile",
  requireRole("OWNER", "MANAGER"),
  controller.getProfile
);

router.get(
  "/setup-checklist",
  requireRole("OWNER", "MANAGER"),
  controller.getChecklist
);

router.get(
  "/document-settings",
  requireRole("OWNER", "MANAGER"),
  controller.getDocumentConfig
);

// Write endpoints
router.patch(
  "/profile",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER"),
  controller.patchProfile
);

router.patch(
  "/document-settings",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER"),
  controller.patchDocumentConfig
);

router.post(
  "/logo-upload-url",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER"),
  controller.createLogoUploadUrl
);

module.exports = router;