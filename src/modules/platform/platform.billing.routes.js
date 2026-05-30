const express = require("express");
const router = express.Router();

const controller = require("./platform.billing.controller");
const {
  requirePlatformAuth,
  requirePlatformRole,
} = require("./platform.auth.middleware");

const canViewBilling = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN",
  "PLATFORM_SUPPORT"
);

const canControlBilling = requirePlatformRole(
  "PLATFORM_OWNER",
  "PLATFORM_ADMIN"
);

router.get(
  "/overview",
  requirePlatformAuth,
  canViewBilling,
  controller.getBillingOverview
);

router.get(
  "/subscriptions",
  requirePlatformAuth,
  canViewBilling,
  controller.listSubscriptions
);

router.get(
  "/subscriptions/tenant/:tenantId",
  requirePlatformAuth,
  canViewBilling,
  controller.getSubscriptionByTenant
);

router.patch(
  "/subscriptions/tenant/:tenantId/access",
  requirePlatformAuth,
  canControlBilling,
  controller.updateSubscriptionAccess
);

router.post(
  "/subscriptions/tenant/:tenantId/renew",
  requirePlatformAuth,
  canControlBilling,
  controller.renewSubscription
);

router.get(
  "/payments",
  requirePlatformAuth,
  canViewBilling,
  controller.listPayments
);

router.get(
  "/payments/:id",
  requirePlatformAuth,
  canViewBilling,
  controller.getPaymentById
);

module.exports = router;