const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const momoService = require("./momo.service");
const paymentController = require("./payment.controller");

// Owner intent (before payment)
router.post("/intents", authController.ownerIntent);

// Owner payment (MoMo sandbox)
router.post("/owner-payment", async (req, res) => {
  const { intentId, amount, phone } = req.body;

  // STRICT MSISDN validation for MoMo sandbox
  const msisdnRegex = /^2507\d{8}$/;

  if (!intentId || !amount || !phone) {
    return res
      .status(400)
      .json({ message: "intentId, amount, phone required" });
  }

  if (!msisdnRegex.test(phone)) {
    return res.status(400).json({
      message: "Invalid MSISDN format. Use 2507XXXXXXXX",
    });
  }

  try {
    const result = await momoService.createPayment(intentId, amount, phone);
    return res.status(202).json({
      message: "Payment request sent to MoMo",
      paymentReference: result.paymentReference,
      intentId: result.intentId,
    });
  } catch (err) {
    console.error("MoMo ERROR DETAILS:");
    console.error(err.response?.data || err.message);

    return res.status(500).json({
      message: "MoMo payment failed",
      error: err.response?.data || err.message,
    });
  }
});

// MoMo webhook callback (ONLY ONCE)
router.post(
  "/payments/momo/callback",
  express.json(),
  paymentController.momoCallback,
);
router.post(
  "/payments/momo/callback/dev",
  express.json(),
  paymentController.momoCallbackDev,
);

// Tenant owner signup (after payment confirmation)
router.post("/signup/initiate", authController.initiateSignup);
router.post("/signup/confirm", authController.confirmSignup);

// Tenant user login (owner & staff)
router.post("/login", authController.login);

// Password reset
router.post("/password/forgot", authController.forgotPassword);
router.post("/password/reset", authController.resetPassword);

module.exports = router;
