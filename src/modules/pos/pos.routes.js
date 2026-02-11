const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const requireActiveSubscription = require("../../middlewares/requireActiveSubscription");

// Sales (CASH + CREDIT)
router.post(
  "/sales",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.createSale
);

router.get(
  "/sales",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.listSales
);

router.get(
  "/sales/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.getSaleReceipt
);

// Add payment to a CREDIT sale
router.post(
  "/sales/:id/payments",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.addSalePayment
);

// Credit reports
router.get(
  "/credit/outstanding",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.listOutstandingCredit
);

router.get(
  "/credit/overdue",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  posController.listOverdueCredit
);

module.exports = router;
