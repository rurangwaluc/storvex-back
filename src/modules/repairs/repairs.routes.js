const express = require("express");

const router = express.Router();

const repairsController = require("./repairs.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const readBase = [authenticate, requireTenant, requireActiveSubscription];

const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_CREATE),
  repairsController.createRepair
);

router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getRepairs
);

router.get(
  "/technicians",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getTechnicians
);

router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getRepairById
);

router.put(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.updateRepair
);

router.put(
  "/:id/status",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.updateRepairStatus
);

router.put(
  "/:id/assign",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.assignTechnician
);

router.delete(
  "/:id/archive",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.archiveRepair
);

router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.deleteRepair
);

module.exports = router;