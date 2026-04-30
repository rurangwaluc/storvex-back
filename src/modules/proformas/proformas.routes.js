"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./proformas.controller");

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

// -----------------------
// GET /api/proformas
// -----------------------
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.listProformas
);

// -----------------------
// POST /api/proformas
// -----------------------
router.post(
  "/",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_CREATE_SALE),
  controller.createProforma
);

// -----------------------
// GET /api/proformas/:id
// -----------------------
router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.getProforma
);

// -----------------------
// PATCH /api/proformas/:id
// -----------------------
router.patch(
  "/:id",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_CREATE_SALE),
  controller.updateProforma
);

// -----------------------
// DELETE /api/proformas/:id
// -----------------------
router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_CREATE_SALE),
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
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.printProformaHtml
);

module.exports = router;