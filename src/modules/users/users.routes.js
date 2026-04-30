// src/modules/users/users.routes.js
const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const {
  enforceSeatLimitOnCreate,
  enforceSeatLimitOnUpdate,
} = require("../../middlewares/enforceStaffSeatLimit");
const { PERMISSIONS } = require("../auth/permissions");

const usersController = require("./users.controller");

// Users/staff routes keep auth + tenant + subscription at route level for now.
// We switch from legacy owner-only role gates to permission-based access.

// READ
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_VIEW),
  usersController.listUsers
);

router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_VIEW),
  usersController.getUser
);

// CREATE
router.post(
  "/",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_CREATE),
  enforceSeatLimitOnCreate,
  usersController.createUser
);

// UPDATE
router.put(
  "/:id",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_EDIT),
  enforceSeatLimitOnUpdate,
  usersController.updateUser
);

// ACTIVATE / DEACTIVATE
router.patch(
  "/:id/status",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_DEACTIVATE),
  enforceSeatLimitOnUpdate,
  usersController.setUserActiveStatus
);

// RESET PASSWORD
router.post(
  "/:id/reset-password",
  express.json(),
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_RESET_PASSWORD),
  usersController.resetUserPassword
);

// DELETE = soft deactivate in current controller behavior
router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_DEACTIVATE),
  usersController.deleteUser
);

module.exports = router;