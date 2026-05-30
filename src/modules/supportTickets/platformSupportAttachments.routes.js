const express = require("express");

const {
  requirePlatformAuth,
} = require("../platform/platform.auth.middleware");

const controller = require("./platformSupportAttachments.controller");

const router = express.Router();

router.post(
  "/upload",
  requirePlatformAuth,
  controller.createPlatformSupportAttachmentUpload
);

router.get(
  "/:id/download-url",
  requirePlatformAuth,
  controller.getPlatformSupportAttachmentDownloadUrl
);

module.exports = router;