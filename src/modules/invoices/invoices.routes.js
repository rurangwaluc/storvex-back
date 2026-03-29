"use strict";
const express = require("express");
const router = express.Router();

const controller = require("./invoices.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");

// -----------------------
// List invoices
// -----------------------
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"),
  controller.listInvoices
);

// -----------------------
// Get invoice by ID
// -----------------------
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"),
  controller.getInvoice
);

// -----------------------
// Print invoice (HTML)
// Accepts Authorization header OR ?token=
// -----------------------
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"),
  controller.printInvoiceHtml
);

module.exports = router;