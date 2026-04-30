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

// Create repair
router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_CREATE),
  repairsController.createRepair
);

// List all repairs
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getRepairs
);

// IMPORTANT: static routes must come before /:id to avoid being shadowed
// Get technicians list
router.get(
  "/technicians",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getTechnicians
);

// Get single repair
router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.REPAIRS_VIEW),
  repairsController.getRepairById
);

// Update full repair details
router.put(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.updateRepair
);

// Update repair status only
router.put(
  "/:id/status",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.updateRepairStatus
);

// Assign technician
router.put(
  "/:id/assign",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.assignTechnician
);

// Archive repair (soft delete)
router.delete(
  "/:id/archive",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.archiveRepair
);

// Hard delete repair
router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.REPAIRS_EDIT),
  repairsController.deleteRepair
);

module.exports = router;