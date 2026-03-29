const express = require("express");
const router = express.Router();
const repairsController = require("./repairs.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

// ==========================
// REPAIR ROUTES
// ==========================

// Create repair (OWNER & CASHIER)
router.post(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "CASHIER"),
  repairsController.createRepair
);

// List all repairs (OWNER, CASHIER, TECHNICIAN)
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  repairsController.getRepairs
);

// Get single repair (OWNER, CASHIER, TECHNICIAN)
router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  repairsController.getRepairById
);

// Update full repair details (OWNER & CASHIER)
router.put(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "CASHIER"),
  repairsController.updateRepair
);

// Update repair status only (OWNER & TECHNICIAN)
router.put(
  "/:id/status",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER", "TECHNICIAN"),
  repairsController.updateRepairStatus
);

// Assign technician (OWNER only)
router.put(
  "/:id/assign",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  repairsController.assignTechnician
);

// Archive repair (soft delete) (OWNER only)
router.delete(
  "/:id/archive",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  repairsController.archiveRepair
);

// Hard delete repair (OWNER only)
router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  repairsController.deleteRepair
);

router.get(
  "/technicians",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  repairsController.getTechnicians
);

module.exports = router;