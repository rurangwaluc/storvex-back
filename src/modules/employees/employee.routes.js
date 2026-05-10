// backend/src/modules/employees/employee.routes.js
const express = require("express");

const router = express.Router();

const controller = require("./employee.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const {
  enforceSeatLimitOnCreate,
  enforceSeatLimitOnUpdate,
} = require("../../middlewares/enforceStaffSeatLimit");
const { PERMISSIONS } = require("../auth/permissions");

const readBase = [authenticate, requireTenant, requireActiveSubscription];

const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

// List staff members.
// OWNER can view. MANAGER can view if MEMBERS_VIEW is granted.
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.MEMBERS_VIEW),
  controller.listEmployees
);

// Create staff member.
// This should be owner-grade by permission policy.
// Your current permissions.js correctly removed MEMBERS_CREATE from MANAGER.
router.post(
  "/",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.MEMBERS_CREATE),
  enforceSeatLimitOnCreate,
  controller.createEmployee
);

// Update staff member profile, role, branch access, or password if included.
// This should be owner-grade by permission policy.
router.put(
  "/:id",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.MEMBERS_EDIT),
  enforceSeatLimitOnUpdate,
  controller.updateEmployee
);

// Activate/deactivate staff member.
// This should be owner-grade by permission policy.
router.patch(
  "/:id/status",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.MEMBERS_DEACTIVATE),
  enforceSeatLimitOnUpdate,
  controller.setEmployeeActiveStatus
);

// Reset staff password.
// This should be owner-grade by permission policy.
router.post(
  "/:id/reset-password",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.MEMBERS_RESET_PASSWORD),
  controller.resetEmployeePassword
);

// Soft-remove staff member by deactivating the account.
// This should be owner-grade by permission policy.
router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.MEMBERS_DEACTIVATE),
  controller.deleteEmployee
);

module.exports = router;