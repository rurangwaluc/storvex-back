"use strict";

const express = require("express");
const router  = express.Router();

const authenticate    = require("../../middlewares/authenticate");
const requireTenant   = require("../../middlewares/requireTenant");
const requireRole     = require("../../middlewares/requireRole");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");

const controller = require("./whatsapp.promotions.controller");

/**
 * WhatsApp promotions
 *
 * Promotions hold the title + message body that broadcasts send to customers.
 * Locked to OWNER and MANAGER — the same roles that control broadcasts.
 */
const readGuard  = [authenticate, requireTenant, requireActiveSubscription,  requireRole("OWNER", "MANAGER")];
const writeGuard = [authenticate, requireTenant, requireWritableSubscription, requireRole("OWNER", "MANAGER")];

router.get("/promotions",     ...readGuard,  controller.listPromotions);
router.post("/promotions",    ...writeGuard, controller.createPromotion);
router.patch("/promotions/:id", ...writeGuard, controller.updatePromotion);

module.exports = router;