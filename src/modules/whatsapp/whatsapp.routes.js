"use strict";

const express = require("express");
const router = express.Router();

const webhookController = require("./whatsapp.controller");

const inboxRoutes = require("./whatsapp.inbox.routes");
const accountRoutes = require("./whatsapp.accounts.routes");
const broadcastRoutes = require("./whatsapp.broadcasts.routes");
const promotionRoutes = require("./whatsapp.promotions.routes");

/**
 * WhatsApp module parent router
 *
 * Mounted from the main app as:
 * /api/whatsapp
 *
 * Public Meta webhook:
 * GET  /api/whatsapp/webhook
 * POST /api/whatsapp/webhook
 *
 * Protected workspace routes:
 * /api/whatsapp/accounts/...
 * /api/whatsapp/inbox/...
 * /api/whatsapp/broadcasts/...
 * /api/whatsapp/promotions/...
 */

/**
 * Public Meta webhook routes.
 *
 * These MUST remain unauthenticated because Meta calls them directly.
 * Do not add authenticate/requireTenant/requireRole here.
 */
router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", webhookController.receiveWebhook);

/**
 * Protected child routers.
 *
 * Each child router applies its own:
 * - authenticate
 * - requireTenant
 * - requireRole
 */
router.use("/", accountRoutes);
router.use("/", inboxRoutes);
router.use("/", broadcastRoutes);
router.use("/", promotionRoutes);

module.exports = router;