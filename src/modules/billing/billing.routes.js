// src/modules/billing/billing.routes.js
const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");

const billing = require("./billing.controller");

/**
 * Billing must remain reachable even when subscription is expired/read-only.
 * Otherwise a locked tenant cannot renew.
 */

router.get(
  "/plans",
  authenticate,
  requireTenant,
  billing.listBillingPlans
);

router.get(
  "/overview",
  authenticate,
  requireTenant,
  billing.getBillingOverview
);

router.get(
  "/usage",
  authenticate,
  requireTenant,
  billing.getBillingUsage
);

router.post(
  "/renew",
  express.json(),
  authenticate,
  requireTenant,
  billing.initiateRenewalPayment
);

router.post(
  "/renew/dev-success",
  express.json(),
  authenticate,
  requireTenant,
  billing.devMarkRenewalPaymentSuccessful
);

router.get(
  "/payments/:reference",
  authenticate,
  requireTenant,
  billing.getRenewalPaymentStatus
);

module.exports = router;