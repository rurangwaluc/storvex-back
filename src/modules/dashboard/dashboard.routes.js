const express = require("express");
const router = express.Router();

const { tenantDashboard } = require("./tenantDashboard.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");

router.get(
  "/tenant",
  authenticate,
  requireTenant,
  tenantDashboard
);


module.exports = router;
