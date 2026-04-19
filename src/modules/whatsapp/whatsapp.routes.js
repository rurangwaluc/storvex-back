"use strict";

const express = require("express");
const router  = express.Router();

const webhookController  = require("./whatsapp.controller");
const inboxRoutes        = require("./whatsapp.inbox.routes");
const accountRoutes      = require("./whatsapp.accounts.routes");
const broadcastRoutes    = require("./whatsapp.broadcasts.routes");
const promotionRoutes    = require("./whatsapp.promotions.routes");

/**
 * Public Meta webhook routes — MUST remain unauthenticated.
 */
router.get("/webhook",  webhookController.verifyWebhook);
router.post("/webhook", webhookController.receiveWebhook);

/**
 * Protected WhatsApp workspace routes.
 * Each child router applies its own auth + tenant + role guards.
 */
router.use("/", inboxRoutes);
router.use("/", accountRoutes);
router.use("/", broadcastRoutes);
router.use("/", promotionRoutes);

module.exports = router;