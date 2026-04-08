const express = require("express");
const router = express.Router();

const webhookController = require("./whatsapp.controller");
const inboxRoutes = require("./whatsapp.inbox.routes");
const accountRoutes = require("./whatsapp.accounts.routes");

/**
 * Public Meta webhook routes
 * These must stay public.
 */
router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", webhookController.receiveWebhook);

/**
 * Protected WhatsApp workspace routes
 * Their own files already apply auth/tenant/role guards.
 */
router.use("/", inboxRoutes);
router.use("/", accountRoutes);

module.exports = router;