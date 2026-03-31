const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

const controller = require("./interStore.controller");

router.use(authenticate, requireTenant, requireActiveSubscription);

router.get(
  "/internal-suppliers",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.listInternalSuppliers
);

router.get(
  "/internal-suppliers/:supplierTenantId/products",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.searchInternalSupplierProducts
);

router.get(
  "/outstanding",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.listOutstanding
);

router.get(
  "/overdue",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.listOverdue
);

router.get(
  "/search",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.searchDeals
);

router.get(
  "/collections/search",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.searchCollections
);

router.get(
  "/payments",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.listPayments
);

router.get(
  "/audit",
  requireRole("OWNER", "MANAGER"),
  controller.listDealAudit
);

router.get(
  "/",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.listDeals
);

router.post(
  "/",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.createDeal
);

router.post(
  "/:id/receive",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.markReceived
);

router.post(
  "/:id/sell",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.markSold
);

router.post(
  "/:id/return",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.markReturned
);

router.post(
  "/:id/paid",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER"),
  controller.markPaid
);

router.get(
  "/:id/payments",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.getDealPayments
);

router.post(
  "/:id/payments",
  express.json(),
  requireWritableSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.addPayment
);

router.get(
  "/:id",
  requireRole("OWNER", "MANAGER", "CASHIER"),
  controller.getDeal
);

module.exports = router;