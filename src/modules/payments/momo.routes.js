const express = require("express");
const router = express.Router();
const momoController = require("./momo.controller");

router.post("/request", momoController.requestMoMoPayment);
router.post("/webhook", momoController.momoWebhook);

module.exports = router;
