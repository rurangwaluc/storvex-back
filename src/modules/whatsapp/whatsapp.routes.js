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
 * /api/whatsapp/inbox/...
 * /api/whatsapp/accounts/...
 * /api/whatsapp/broadcasts/...
 * /api/whatsapp/promotions/...
 */

/**
 * Public Meta webhook routes.
 *
 * These MUST remain unauthenticated because Meta calls them directly.
 */
router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", webhookController.receiveWebhook);

/**
 * IMPORTANT:
 * Mount inbox first.
 *
 * Some child routers apply role middleware at router level.
 * If owner-only routers are mounted before inbox, they can reject
 * /inbox requests before inboxRoutes gets a chance to handle them.
 */
router.use("/", inboxRoutes);

/**
 * Owner/manager WhatsApp management routes.
 */
router.use("/", accountRoutes);
router.use("/", broadcastRoutes);
router.use("/", promotionRoutes);

module.exports = router;