// src/modules/dashboard/dashboard.routes.js
const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
} = require("../../middlewares/requireActiveSubscription");
const { getTenantDashboard } = require("./tenantDashboard.controller");

router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  getTenantDashboard
);

module.exports = router;