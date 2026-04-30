"use strict";

const express = require("express");
const router = express.Router();

const controller = require("./warranties.controller");

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
// GET /api/warranties
// -----------------------
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.listWarranties
);

// -----------------------
// POST /api/warranties
// -----------------------
router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.WARRANTY_CREATE),
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
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.printWarrantyHtml
);

// -----------------------
// GET /api/warranties/:id
// -----------------------
router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  controller.getWarranty
);

// -----------------------
// PATCH /api/warranties/:id
// -----------------------
router.patch(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.WARRANTY_CREATE),
  controller.updateWarranty
);

// -----------------------
// DELETE /api/warranties/:id
// -----------------------
router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.WARRANTY_CREATE),
  controller.deleteWarranty
);

module.exports = router;