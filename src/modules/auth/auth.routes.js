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

function cleanString(value) {
  const s = String(value || "").trim();
  return s || "";
}

async function createOwnerPayment(req, res) {
  const { intentId, phone, planKey } = req.body || {};

  if (!intentId || !phone || !planKey) {
    return res.status(400).json({
      message: "intentId, planKey, phone required",
    });
  }

  const phoneNorm = normalizePhoneTo250(phone);

  if (!phoneNorm || !isRwandaMsisdn250(phoneNorm)) {
    return res.status(400).json({
      message: "Invalid MSISDN format. Use 07XXXXXXXX or 2507XXXXXXXX",
    });
  }

  try {
    const result = await momoService.createPaymentFromPlan(
      cleanString(intentId),
      cleanString(planKey),
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
}

// -----------------------------------------------------------------------------
// Public onboarding routes
// -----------------------------------------------------------------------------

// Owner intent: first signup step before OTP/payment.
router.post("/owner-intent", authController.ownerIntent);
router.post("/signup/owner-intent", authController.ownerIntent);

// OTP verification.
router.post("/otp/send", otpController.sendOtp);
router.post("/otp/verify", otpController.verifyOtp);

// Cleaner onboarding aliases.
router.post("/signup/otp/send", otpController.sendOtp);
router.post("/signup/otp/verify", otpController.verifyOtp);

// Server-authoritative pricing plans.
router.get("/plans", (req, res) => {
  return res.json({
    trialDays: getTrialDays(),
    plans: getPaidPlans(),
  });
});

// Owner payment.
router.post("/owner-payment", createOwnerPayment);
router.post("/signup/payment", createOwnerPayment);

// Final owner signup.
// This creates tenant, owner user, main branch, subscription, branch assignment,
// and returns token + workspace context.
router.post("/confirm-signup", authController.confirmSignup);
router.post("/signup/confirm", authController.confirmSignup);

// Legacy/mock route kept to avoid breaking older frontend calls.
router.post("/signup/initiate", authController.initiateSignup);

// Login.
router.post("/login", authController.login);

// Password reset.
router.post("/password/forgot", authController.forgotPassword);
router.post("/password/reset", authController.resetPassword);

// -----------------------------------------------------------------------------
// Authenticated account/workspace route
// -----------------------------------------------------------------------------

router.get("/me", authenticate, meController.me);

// -----------------------------------------------------------------------------
// Payment callbacks
// -----------------------------------------------------------------------------

// MoMo webhook callback.
router.post(
  "/payments/momo/callback",
  express.json(),
  paymentController.momoCallback
);

// Local/dev callback simulator.
router.post(
  "/payments/momo/callback/dev",
  express.json(),
  paymentController.momoCallbackDev
);

module.exports = router;