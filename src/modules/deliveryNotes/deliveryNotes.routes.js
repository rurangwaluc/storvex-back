"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./deliveryNotes.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const readBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
];

const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_VIEW),
  controller.listDeliveryNotes
);

router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_CREATE),
  controller.createDeliveryNote
);

router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_VIEW),
  controller.getDeliveryNote
);

router.patch(
  "/:id",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_CREATE),
  controller.updateDeliveryNote
);

router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_CREATE),
  controller.deleteDeliveryNote
);

router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_VIEW),
  controller.printDeliveryNoteHtml
);

module.exports = router;