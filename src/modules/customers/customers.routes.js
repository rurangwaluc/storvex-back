const express = require("express");
const router = express.Router();

const customersController = require("./customers.controller");

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

// CREATE
router.post(
  "/",
  ...writeBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_CREATE),
  customersController.createCustomer
);

// LIST / SEARCH
router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_VIEW),
  customersController.getCustomers
);

// IMPORTANT: static routes BEFORE dynamic :id routes
router.get(
  "/ledger/summary/outstanding",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_CREDIT),
  customersController.getCreditSummary
);

router.get(
  "/:id/ledger",
  ...readBase,
  requireDbPermission(PERMISSIONS.POS_VIEW_CREDIT),
  customersController.getCustomerLedger
);

// READ ONE
router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_VIEW),
  customersController.getCustomerById
);

// UPDATE
router.put(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_EDIT),
  customersController.updateCustomer
);

// DEACTIVATE
router.delete(
  "/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_EDIT),
  customersController.deactivateCustomer
);

// REACTIVATE
router.put(
  "/:id/reactivate",
  ...writeBase,
  requireDbPermission(PERMISSIONS.CUSTOMERS_EDIT),
  customersController.reactivateCustomer
);

module.exports = router;