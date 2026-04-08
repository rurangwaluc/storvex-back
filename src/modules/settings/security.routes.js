const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const {
  getSecurityOverview,
  getSecuritySessions,
  getSecurityLoginEvents,
  revokeSecuritySession,
  revokeOtherSecuritySessions,
  changeMyPassword,
} = require("./security.controller");

router.get(
  "/overview",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  getSecurityOverview
);

router.get(
  "/sessions",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  getSecuritySessions
);

router.delete(
  "/sessions/:sessionId",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  revokeSecuritySession
);

router.post(
  "/sessions/revoke-others",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  revokeOtherSecuritySessions
);

router.get(
  "/login-events",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  getSecurityLoginEvents
);

router.post(
  "/change-password",
  authenticate,
  requireTenant,
  requireRole("OWNER", "MANAGER"),
  changeMyPassword
);

module.exports = router;