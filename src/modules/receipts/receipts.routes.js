"use strict";
const express = require("express");
const router = express.Router();

const controller = require("./receipts.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");

// Allowed electronics retail roles
const ALLOWED_ROLES = ["OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"];

// List all receipts
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ALLOWED_ROLES),
  controller.listReceipts
);

// Get a single receipt
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ALLOWED_ROLES),
  controller.getReceipt
);

// Print receipt HTML
// ✅ Accepts Authorization header OR ?token= for external printing
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ALLOWED_ROLES),
  controller.printReceiptHtml
);

module.exports = router;