const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const {
  listAuditLogs,
  getAuditLogById,
  getAuditLogStats,
  getAuditBranches,
} = require("./audit.controller");

/**
 * Multi-branch audit access:
 * - OWNER can see tenant-wide audit logs.
 * - MANAGER can see audit logs only for assigned branches.
 * - Service layer enforces branch visibility.
 */
router.use(authenticate, requireTenant, requireRole("OWNER", "MANAGER"));

router.get("/", listAuditLogs);
router.get("/stats", getAuditLogStats);
router.get("/branches", getAuditBranches);
router.get("/:id", getAuditLogById);

module.exports = router;