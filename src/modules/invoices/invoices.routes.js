"use strict";
const express = require("express");
const router = express.Router();

const controller = require("./invoices.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

// List invoices
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.listInvoices
);

// Get invoice by ID
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.getInvoice
);

// Print invoice (HTML)
// Accepts Authorization header OR ?token=
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.printInvoiceHtml
);

module.exports = router;