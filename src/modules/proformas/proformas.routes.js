"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./proformas.controller");

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

const CREATE_EDIT_ROLES = [
  "OWNER",
  "MANAGER",
  "SELLER",
  "CASHIER",
];

const DELETE_ROLES = [
  "OWNER",
  "MANAGER",
];

// -----------------------
// GET /api/proformas
// -----------------------
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.listProformas
);

// -----------------------
// POST /api/proformas
// -----------------------
router.post(
  "/",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...CREATE_EDIT_ROLES),
  controller.createProforma
);

// -----------------------
// GET /api/proformas/:id
// -----------------------
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.getProforma
);

// -----------------------
// PATCH /api/proformas/:id
// -----------------------
router.patch(
  "/:id",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...CREATE_EDIT_ROLES),
  controller.updateProforma
);

// -----------------------
// DELETE /api/proformas/:id
// -----------------------
router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole(...DELETE_ROLES),
  controller.deleteProforma
);

// -----------------------
// GET /api/proformas/:id/print
// Accepts Authorization header OR ?token=
// -----------------------
router.get(
  "/:id/print",
  authenticateHeaderOrQueryToken,
  requireTenant,
  requireActiveSubscription,
  requireRole(...ELECTRONICS_ROLES),
  controller.printProformaHtml
);

module.exports = router;