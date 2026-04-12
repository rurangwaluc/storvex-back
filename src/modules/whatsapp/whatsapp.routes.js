const express = require("express");

const router = express.Router();

const webhookController = require("./whatsapp.controller");
const inboxRoutes = require("./whatsapp.inbox.routes");
const accountRoutes = require("./whatsapp.accounts.routes");
const broadcastRoutes = require("./whatsapp.broadcasts.routes");

/**
 * Public Meta webhook routes
 * These must stay public.
 */
router.get("/webhook", webhookController.verifyWebhook);
router.post("/webhook", webhookController.receiveWebhook);

/**
 * Protected WhatsApp workspace routes
 * Each child router already applies its own auth / tenant / role guards.
 * We keep that pattern so we do not damage what is already working.
 */
router.use("/", inboxRoutes);
router.use("/", accountRoutes);
router.use("/", broadcastRoutes);

module.exports = router;