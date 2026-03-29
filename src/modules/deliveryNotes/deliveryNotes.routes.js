"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./deliveryNotes.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

const ELECTRONICS_ROLES = [
  "OWNER",
  "MANAGER",
  "STOREKEEPER",
  "SELLER",
  "CASHIER",
  "TECHNICIAN",
];

router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.listDeliveryNotes
);

router.post(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER"),
  controller.createDeliveryNote
);

router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.getDeliveryNote
);

router.patch(
  "/:id",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER"),
  controller.updateDeliveryNote
);

router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER"),
  controller.deleteDeliveryNote
);

router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.printDeliveryNoteHtml
);

module.exports = router;