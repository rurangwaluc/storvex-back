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

const base = [authenticate, requireTenant, requireActiveSubscription];

router.get(
  "/",
  ...base,
  requireDbPermission("user.view"),
  controller.listEmployees
);

router.post(
  "/",
  express.json(),
  ...base,
  requireWritableSubscription,
  requireDbPermission("user.create"),
  enforceSeatLimitOnCreate,
  controller.createEmployee
);

router.put(
  "/:id",
  express.json(),
  ...base,
  requireWritableSubscription,
  requireDbPermission("user.update"),
  enforceSeatLimitOnUpdate,
  controller.updateEmployee
);

router.patch(
  "/:id/status",
  express.json(),
  ...base,
  requireWritableSubscription,
  requireDbPermission("user.deactivate"),
  enforceSeatLimitOnUpdate,
  controller.setEmployeeActiveStatus
);

router.post(
  "/:id/reset-password",
  express.json(),
  ...base,
  requireWritableSubscription,
  requireDbPermission("user.update"),
  controller.resetEmployeePassword
);

router.delete(
  "/:id",
  ...base,
  requireWritableSubscription,
  requireDbPermission("user.deactivate"),
  controller.deleteEmployee
);

module.exports = router;