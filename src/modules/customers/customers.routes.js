const express = require("express");
const router = express.Router();

const customersController = require("./customers.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

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
  requireRole("OWNER", "MANAGER", "CASHIER", "SELLER"),
  customersController.createCustomer
);

// LIST / SEARCH
router.get(
  "/",
  ...readBase,
  requireRole("OWNER", "MANAGER", "CASHIER", "SELLER", "TECHNICIAN"),
  customersController.getCustomers
);

// IMPORTANT: static routes BEFORE dynamic :id routes
router.get(
  "/ledger/summary/outstanding",
  ...readBase,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  customersController.getCreditSummary
);

router.get(
  "/:id/ledger",
  ...readBase,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  customersController.getCustomerLedger
);

// READ ONE
router.get(
  "/:id",
  ...readBase,
  requireRole("OWNER", "MANAGER", "CASHIER", "SELLER", "TECHNICIAN"),
  customersController.getCustomerById
);

// UPDATE
router.put(
  "/:id",
  ...writeBase,
  requireRole("OWNER", "MANAGER", "CASHIER", "SELLER"),
  customersController.updateCustomer
);

// DEACTIVATE
router.delete(
  "/:id",
  ...writeBase,
  requireRole("OWNER", "MANAGER"),
  customersController.deactivateCustomer
);

// REACTIVATE
router.put(
  "/:id/reactivate",
  ...writeBase,
  requireRole("OWNER", "MANAGER"),
  customersController.reactivateCustomer
);

module.exports = router;