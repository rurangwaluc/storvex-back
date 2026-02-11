const express = require("express");
const router = express.Router();

const reportsController = require("./reports.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

// Sales summary
router.get(
  "/sales",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  reportsController.salesSummary
);

// Inventory report
router.get(
  "/inventory",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  reportsController.inventoryReport
);

// Repairs report
router.get(
  "/repairs",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  reportsController.repairsReport
);

module.exports = router;
