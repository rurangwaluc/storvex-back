const express = require("express");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
} = require("../../middlewares/requireActiveSubscription");

const controller = require("./supportAttachments.controller");

const router = express.Router();

router.post(
  "/upload",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  controller.createSupportAttachmentUpload
);

router.get(
  "/:id/download-url",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  controller.getSupportAttachmentDownloadUrl
);

module.exports = router;