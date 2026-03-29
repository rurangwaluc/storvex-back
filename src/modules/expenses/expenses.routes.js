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

// Recommended policy:
// - CASHIER/TECHNICIAN can create (request)
// - OWNER can list/approve/delete

router.post(
  "/",
  ...writeBase,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  controller.createExpense
);

router.get(
  "/",
  ...readBase,
  requireRole("OWNER"),
  controller.listExpenses
);

router.patch(
  "/:id/approve",
  ...writeBase,
  requireRole("OWNER"),
  controller.approveExpense
);

router.delete(
  "/:id",
  ...writeBase,
  requireRole("OWNER"),
  controller.deleteExpense
);

module.exports = router;