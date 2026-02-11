const express = require("express");
const router = express.Router();
const controller = require("./payments.controller");
const { momoWebhook } = require("./payments.webhook");

router.post("/initiate", controller.initiatePayment);
router.post("/webhook", momoWebhook);

module.exports = router;
