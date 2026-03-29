const express = require("express");
const router = express.Router();

const suppliersController = require("./suppliers.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

// Suppliers
router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  suppliersController.listSuppliers
);

router.post(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  suppliersController.createSupplier
);

router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  suppliersController.getSupplier
);

router.put(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  suppliersController.updateSupplier
);

router.patch(
  "/:id/activate",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  suppliersController.activateSupplier
);

router.patch(
  "/:id/deactivate",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  suppliersController.deactivateSupplier
);

// Supplies (deliveries)
router.get(
  "/:id/supplies",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  suppliersController.listSupplies
);

router.post(
  "/:id/supplies",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
  requireRole("OWNER"),
  suppliersController.createSupply
);

module.exports = router;