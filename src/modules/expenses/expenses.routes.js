const express = require("express");
const router = express.Router();

const controller = require("./expenses.controller");
const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

// OWNER only
router.post(
  "/",
  authenticate,
  requireTenant,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  controller.createExpense,
);

router.get(
  "/",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  controller.listExpenses,
);
router.patch(
  "/:id/approve",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  controller.approveExpense,
);
router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  controller.deleteExpense,
);

module.exports = router;
