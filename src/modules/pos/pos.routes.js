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

// Quick picks
router.get(
  "/quick-picks",
  ...readBase,
  requireDbPermission("sale.view"),
  posController.quickPicks
);

// Sales
router.post(
  "/sales",
  ...writeBase,
  requireDbPermission("sale.create"),
  posController.createSale
);

router.get(
  "/sales",
  ...readBase,
  requireDbPermission("sale.view"),
  posController.listSales
);

// Receipt / sale details
router.get(
  "/sales/:id",
  ...readBase,
  requireDbPermission("sale.view"),
  posController.getSaleReceipt
);

router.get(
  "/sales/:id/receipt",
  ...readBase,
  requireDbPermission("sale.view"),
  posController.getSaleReceipt
);

// Add payment to a credit sale
router.post(
  "/sales/:id/payments",
  ...writeBase,
  requireDbPermission("payment.add"),
  posController.addSalePayment
);

// Create warranty for a sale
router.post(
  "/sales/:id/warranty",
  ...writeBase,
  requireDbPermission("warranty.create"),
  posController.createSaleWarranty
);

// Credit reports
router.get(
  "/credit/outstanding",
  ...readBase,
  requireDbPermission("report.credit.view"),
  posController.listOutstandingCredit
);

router.get(
  "/credit/overdue",
  ...readBase,
  requireDbPermission("report.credit.view"),
  posController.listOverdueCredit
);

// Cancel sale
router.post(
  "/sales/:id/cancel",
  ...writeBase,
  requireDbPermission("sale.cancel"),
  posController.cancelSale
);

// Refund sale
router.post(
  "/sales/:id/refunds",
  ...writeBase,
  requireDbPermission("sale.refund"),
  posController.createSaleRefund
);

module.exports = router;