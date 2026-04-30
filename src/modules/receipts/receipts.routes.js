"use strict";
const express = require("express");
const router = express.Router();

const controller = require("./receipts.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

// List all receipts
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.listReceipts
);

// Get a single receipt
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.getReceipt
);

// Print receipt HTML
// Accepts Authorization header OR ?token= for external printing
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.printReceiptHtml
);

module.exports = router;