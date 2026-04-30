const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const controller = require("./interStore.controller");

const readBase = [authenticate, requireTenant, requireActiveSubscription];
const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

router.get(
  "/internal-suppliers",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.listInternalSuppliers
);

router.get(
  "/internal-suppliers/:supplierTenantId/products",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.searchInternalSupplierProducts
);

router.get(
  "/outstanding",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.listOutstanding
);

router.get(
  "/overdue",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.listOverdue
);

router.get(
  "/search",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.searchDeals
);

router.get(
  "/collections/search",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.searchCollections
);

router.get(
  "/payments",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.listPayments
);

router.get(
  "/audit",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_AUDIT_VIEW),
  controller.listDealAudit
);

router.get(
  "/",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.listDeals
);

router.post(
  "/",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_CREATE),
  controller.createDeal
);

router.post(
  "/:id/receive",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_RECEIVE),
  controller.markReceived
);

router.post(
  "/:id/sell",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_SELL),
  controller.markSold
);

router.post(
  "/:id/return",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_RETURN),
  controller.markReturned
);

router.post(
  "/:id/paid",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_PAY),
  controller.markPaid
);

router.get(
  "/:id/payments",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.getDealPayments
);

router.post(
  "/:id/payments",
  express.json(),
  ...writeBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_PAYMENT_ADD),
  controller.addPayment
);

router.get(
  "/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.INTERSTORE_VIEW),
  controller.getDeal
);

module.exports = router;