const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");
const { PERMISSIONS } = require("../auth/permissions");

const {
  salesSummary,
  expenseSummary,
  repairSummary,
  dashboard,
  dailyClose,
  topSellers,
  dailyClosePdf,
  periodPdf,
  insights,
  financialSummary,
  incomeStatement,
  cashFlowSummary,
  branchPerformance,
} = require("./reports.controller");

// Reports access should follow permission policy, not hardcoded owner-only role checks.
router.use(
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.REPORTS_VIEW)
);

router.get("/sales-summary", salesSummary);
router.get("/expense-summary", expenseSummary);
router.get("/repair-summary", repairSummary);
router.get("/dashboard", dashboard);
router.get("/daily-close", dailyClose);
router.get("/top-sellers", topSellers);
router.get("/insights", insights);

router.get("/financial-summary", financialSummary);
router.get("/income-statement", incomeStatement);
router.get("/cash-flow", cashFlowSummary);
router.get("/branch-performance", branchPerformance);

router.get("/daily-close.pdf", dailyClosePdf);
router.get("/period.pdf", periodPdf);

module.exports = router;