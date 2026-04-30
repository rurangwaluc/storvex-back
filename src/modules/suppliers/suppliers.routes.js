const express = require("express");
const router = express.Router();

const suppliersController = require("./suppliers.controller");

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

// Suppliers
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_VIEW),
  suppliersController.listSuppliers
);

router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_CREATE),
  suppliersController.createSupplier
);

router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_VIEW),
  suppliersController.getSupplier
);

router.put(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_EDIT),
  suppliersController.updateSupplier
);

router.patch(
  "/:id/activate",
  ...writeBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_EDIT),
  suppliersController.activateSupplier
);

router.patch(
  "/:id/deactivate",
  ...writeBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_EDIT),
  suppliersController.deactivateSupplier
);

// Supplies
router.get(
  "/:id/supplies",
  ...readBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_VIEW),
  suppliersController.listSupplies
);

router.post(
  "/:id/supplies",
  ...writeBase,
  requireDbPermission(PERMISSIONS.SUPPLIERS_EDIT),
  suppliersController.createSupply
);

module.exports = router;