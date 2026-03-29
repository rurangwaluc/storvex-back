// src/modules/users/users.routes.js
const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const {
  enforceSeatLimitOnCreate,
  enforceSeatLimitOnUpdate,
} = require("../../middlewares/enforceStaffSeatLimit");

const usersController = require("./users.controller");

// Legacy owner-only staff/user management endpoints.
// Keep protected so they cannot bypass billing seat limits.

router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  usersController.listUsers
);

router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  usersController.getUser
);

router.post(
  "/",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  enforceSeatLimitOnCreate,
  usersController.createUser
);

router.put(
  "/:id",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  enforceSeatLimitOnUpdate,
  usersController.updateUser
);

router.patch(
  "/:id/status",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  enforceSeatLimitOnUpdate,
  usersController.setUserActiveStatus
);

router.post(
  "/:id/reset-password",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  usersController.resetUserPassword
);

router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  usersController.deleteUser
);

module.exports = router;