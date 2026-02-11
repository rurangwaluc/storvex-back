const express = require("express");
const router = express.Router();

const customersController = require("./customers.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const requireActiveSubscription = require("../../middlewares/requireActiveSubscription");

// Customers CRUD
router.post(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  customersController.createCustomer
);

router.get(
  "/",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  customersController.getCustomers
);

router.get(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER", "TECHNICIAN"),
  customersController.getCustomerById
);

router.put(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  customersController.updateCustomer
);

router.delete(
  "/:id",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  customersController.deactivateCustomer
);

router.put(
  "/:id/reactivate",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER"),
  customersController.reactivateCustomer
);

// ✅ Ledger + summaries (money features)
router.get(
  "/:id/ledger",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  customersController.getCustomerLedger
);

router.get(
  "/ledger/summary/outstanding",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  customersController.getCreditSummary
);

module.exports = router;
