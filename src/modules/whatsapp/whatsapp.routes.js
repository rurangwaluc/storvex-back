const express = require("express");
const router = express.Router();

const controller = require("./whatsapp.controller");

router.get("/webhook", controller.verifyWebhook);
router.post("/webhook", controller.receiveWebhook);

module.exports = router;