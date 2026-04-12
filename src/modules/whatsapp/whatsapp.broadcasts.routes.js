const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.broadcasts.controller");

/**
 * WhatsApp broadcasts
 *
 * Locked to owner and manager because this affects many customers at once.
 * We keep this separate from inbox work so broadcast operations stay clear.
 */
router.use(authenticate, requireTenant, requireRole("OWNER", "MANAGER"));

router.get("/broadcasts", controller.listBroadcasts);
router.get("/broadcasts/:broadcastId", controller.getBroadcast);
router.post("/broadcasts", controller.createBroadcast);
router.patch("/broadcasts/:broadcastId", controller.updateBroadcast);
router.post("/broadcasts/:broadcastId/queue", controller.queueBroadcast);
router.post("/broadcasts/:broadcastId/send", controller.sendBroadcastNow);

module.exports = router;