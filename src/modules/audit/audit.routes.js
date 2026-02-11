const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const { listAuditLogs } = require("./audit.controller");

router.get(
  "/",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  listAuditLogs
);

module.exports = router;
