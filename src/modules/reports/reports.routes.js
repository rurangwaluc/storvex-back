const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const { requireActiveSubscription } = require("../../middlewares/requireActiveSubscription");

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
} = require("./reports.controller");

// Owner only for now
router.use(authenticate, requireTenant, requireActiveSubscription, requireRole("OWNER"));

router.get("/sales-summary", salesSummary);
router.get("/expense-summary", expenseSummary);
router.get("/repair-summary", repairSummary);
router.get("/dashboard", dashboard);
router.get("/daily-close", dailyClose);
router.get("/top-sellers", topSellers);
router.get("/insights", insights);
router.get("/daily-close.pdf", dailyClosePdf);
router.get("/period.pdf", periodPdf);

module.exports = router;