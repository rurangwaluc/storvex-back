const express = require("express");
const router = express.Router();

const controller = require("./expenses.controller");
const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

const readBase = [authenticate, requireTenant, requireActiveSubscription];
const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

// Real-world policy:
// - OWNER / MANAGER can view expenses
// - OWNER / MANAGER / CASHIER / TECHNICIAN can create expense requests
// - OWNER / MANAGER can approve
// - OWNER can delete (kept strict for now)

router.post(
  "/",
  ...writeBase,
  requireRole("OWNER", "MANAGER", "CASHIER", "TECHNICIAN"),
  controller.createExpense
);

router.get(
  "/",
  ...readBase,
  requireRole("OWNER", "MANAGER"),
  controller.listExpenses
);

router.patch(
  "/:id/approve",
  ...writeBase,
  requireRole("OWNER", "MANAGER"),
  controller.approveExpense
);

router.delete(
  "/:id",
  ...writeBase,
  requireRole("OWNER"),
  controller.deleteExpense
);

module.exports = router;