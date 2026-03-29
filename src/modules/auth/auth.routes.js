// src/modules/auth/auth.routes.js

const express = require("express");
const router = express.Router();

const authController = require("./auth.controller");
const momoService = require("./momo.service");
const paymentController = require("./payment.controller");
const otpController = require("./otp.controller");
const meController = require("./me.controller");

const authenticate = require("../../middlewares/authenticate");
const { getPaidPlans, getTrialDays } = require("../../config/plans");

// ---------- helpers ----------
function normalizePhoneTo250(phone) {
  const raw = String(phone || "").trim().replace(/[^\d]/g, "");
  if (!raw) return null;
  if (raw.startsWith("07") && raw.length === 10) return `250${raw.slice(1)}`;
  return raw;
}

function isRwandaMsisdn250(phone) {
  return /^2507\d{8}$/.test(String(phone || ""));
}

// Owner intent (before payment)
router.post("/owner-intent", authController.ownerIntent);

// OTP
router.post("/otp/send", otpController.sendOtp);
router.post("/otp/verify", otpController.verifyOtp);

/**
 * Pricing plans (server-authoritative)
 * GET /api/auth/plans
 */
router.get("/plans", (req, res) => {
  return res.json({
    trialDays: getTrialDays(),
    plans: getPaidPlans(),
  });
});

/**
 * ✅ Who am I + subscription status
 * GET /api/auth/me
 */
router.get("/me", authenticate, meController.me);

/**
 * Owner payment (MoMo sandbox)
 * Body:
 * { intentId, planKey, phone: "07XXXXXXXX" | "2507XXXXXXXX" }
 */
router.post("/owner-payment", async (req, res) => {
  const { intentId, phone, planKey } = req.body;

  if (!intentId || !phone || !planKey) {
    return res.status(400).json({ message: "intentId, planKey, phone required" });
  }

  const phoneNorm = normalizePhoneTo250(phone);
  if (!phoneNorm || !isRwandaMsisdn250(phoneNorm)) {
    return res.status(400).json({
      message: "Invalid MSISDN format. Use 07XXXXXXXX or 2507XXXXXXXX",
    });
  }

  try {
    const result = await momoService.createPaymentFromPlan(
      String(intentId).trim(),
      String(planKey).trim(),
      phoneNorm
    );

    return res.status(202).json({
      message: "Payment request sent to MoMo",
      paymentReference: result.paymentReference,
      intentId: result.intentId,
      plan: result.plan,
      phone: phoneNorm,
    });
  } catch (err) {
    console.error("MoMo ERROR DETAILS:");
    console.error(err.response?.data || err.message);

    return res.status(err.status || 500).json({
      message: err.message || "MoMo payment failed",
      error: err.response?.data || err.message,
    });
  }
});

// MoMo webhook callback
router.post("/payments/momo/callback", express.json(), paymentController.momoCallback);
router.post("/payments/momo/callback/dev", express.json(), paymentController.momoCallbackDev);

// Tenant owner signup
router.post("/signup/initiate", authController.initiateSignup);
router.post("/confirm-signup", authController.confirmSignup);

// Tenant user login
router.post("/login", authController.login);

// Password reset
router.post("/password/forgot", authController.forgotPassword);
router.post("/password/reset", authController.resetPassword);

module.exports = router;