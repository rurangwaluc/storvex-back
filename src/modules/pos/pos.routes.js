// src/modules/pos/pos.routes.js

const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const readBase = [authenticate, requireTenant, requireActiveSubscription];

const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

// Quick picks
router.get(
  "/quick-picks",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW),
  posController.quickPicks
);

// Sales
router.post(
  "/sales",
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_CREATE_SALE),
  posController.createSale
);

router.get(
  "/sales",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  posController.listSales
);

// Receipt / sale details
router.get(
  "/sales/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  posController.getSaleReceipt
);

router.get(
  "/sales/:id/receipt",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  posController.getSaleReceipt
);

// Add payment to a credit sale
router.post(
  "/sales/:id/payments",
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_CREDIT),
  posController.addSalePayment
);

// Create warranty for a sale
router.post(
  "/sales/:id/warranty",
  ...writeBase,
  requireDbPermission(PERMISSIONS.DELIVERY_NOTES_CREATE),
  posController.createSaleWarranty
);

// Credit reports
router.get(
  "/credit/outstanding",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_CREDIT),
  posController.listOutstandingCredit
);

router.get(
  "/credit/overdue",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_CREDIT),
  posController.listOverdueCredit
);

// Cancel sale
router.post(
  "/sales/:id/cancel",
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_CREATE_SALE),
  posController.cancelSale
);

// Refund sale
router.post(
  "/sales/:id/refunds",
  ...writeBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_SALES),
  posController.createSaleRefund
);

module.exports = router;