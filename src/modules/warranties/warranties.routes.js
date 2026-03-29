"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./warranties.controller");

const authenticate = require("../../middlewares/authenticate");
const authenticateHeaderOrQueryToken = require("../../middlewares/authenticateHeaderOrQueryToken");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

const allowedRoles = ["OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"];
const createEditRoles = ["OWNER", "MANAGER", "SELLER", "CASHIER"];
const deleteRoles = ["OWNER", "MANAGER"];

// -----------------------
// GET /api/warranties
// -----------------------
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...allowedRoles),
  controller.listWarranties
);

// -----------------------
// POST /api/warranties
// -----------------------
router.post(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...createEditRoles),
  controller.createWarranty
);

// -----------------------
// GET /api/warranties/:id/print
// Accepts Authorization header or ?token=
// -----------------------
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireRole(...allowedRoles),
  controller.printWarrantyHtml
);

// -----------------------
// GET /api/warranties/:id
// -----------------------
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...allowedRoles),
  controller.getWarranty
);

// -----------------------
// PATCH /api/warranties/:id
// -----------------------
router.patch(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...createEditRoles),
  controller.updateWarranty
);

// -----------------------
// DELETE /api/warranties/:id
// -----------------------
router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...deleteRoles),
  controller.deleteWarranty
);

module.exports = router;