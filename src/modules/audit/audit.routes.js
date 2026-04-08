const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const {
  listAuditLogs,
  getAuditLogById,
  getAuditLogStats,
} = require("./audit.controller");

router.use(authenticate, requireTenant, requireRole("OWNER"));

router.get("/", listAuditLogs);
router.get("/stats", getAuditLogStats);
router.get("/:id", getAuditLogById);

module.exports = router;