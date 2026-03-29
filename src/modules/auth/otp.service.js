// src/modules/auth/otp.service.js
const crypto = require("crypto");
const prisma = require("../../config/database");
const { sendEmailOtp, sendSmsOtp } = require("../notifications");

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_SEND_COOLDOWN_SECONDS = Number(process.env.OTP_SEND_COOLDOWN_SECONDS || 60);
const OTP_PEPPER = String(process.env.OTP_PEPPER || "");
const DEV_OTP_ECHO =
  String(process.env.DEV_OTP_ECHO || "false").toLowerCase() === "true";

const CHANNELS = new Set(["EMAIL", "PHONE"]);

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function normalizeEmail(x) {
  const s = cleanString(x);
  return s ? s.toLowerCase() : null;
}

/**
 * Accepts "2507XXXXXXXX" or "07XXXXXXXX" and normalizes to "2507XXXXXXXX".
 */
function normalizePhone(x) {
  const raw = String(x || "").trim().replace(/[^\d]/g, "");
  if (!raw) return null;
  if (raw.startsWith("07") && raw.length === 10) return `250${raw.slice(1)}`;
  return raw;
}

function isRwandaMsisdn250(phone) {
  return /^2507\d{8}$/.test(String(phone || ""));
}

function hashOtp({ intentId, channel, target, code }) {
  const material = `${OTP_PEPPER}|${intentId}|${channel}|${target}|${code}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function resolveTargetFromIntent(intent, channel) {
  if (!intent) return null;
  return channel === "EMAIL"
    ? normalizeEmail(intent.email)
    : normalizePhone(intent.phone);
}

async function isTrialAlreadyBurned({ email, phone, deviceId, browserFingerprint }) {
  const OR = [];

  if (email) OR.push({ email });
  if (phone) OR.push({ phone });
  if (deviceId) OR.push({ deviceId });
  if (browserFingerprint) OR.push({ browserFingerprint });

  if (OR.length === 0) return false;

  const hit = await prisma.trialGuard.findFirst({
    where: { OR },
    select: { id: true },
  });

  return !!hit;
}

async function logDelivery({
  otpId = null,
  intentId,
  channel,
  target,
  provider = null,
  status,
  reason = null,
  messageId = null,
  metadata = null,
  deliveredAt = null,
}) {
  try {
    await prisma.otpDeliveryLog.create({
      data: {
        otpId,
        intentId,
        channel,
        target,
        provider,
        status,
        reason,
        messageId,
        metadata,
        deliveredAt,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error("OtpDeliveryLog create failed:", err);
  }
}

async function assertCooldown(intentId, channel, target) {
  const recent = await prisma.otpCode.findFirst({
    where: { intentId, channel, target, verifiedAt: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (!recent) return;

  const secondsSince = Math.floor(
    (Date.now() - new Date(recent.createdAt).getTime()) / 1000
  );

  if (secondsSince < OTP_SEND_COOLDOWN_SECONDS) {
    const err = new Error(
      `Please wait ${OTP_SEND_COOLDOWN_SECONDS - secondsSince}s before requesting another OTP.`
    );
    err.status = 429;
    throw err;
  }
}

/**
 * Creates an OTP row, sends via configured provider, and logs the delivery attempt.
 *
 * Returns:
 * {
 *   otpId,
 *   channel,
 *   target,
 *   expiresAt,
 *   sent,
 *   provider,
 *   messageId,
 *   reason,
 *   devOtp
 * }
 */
async function createAndSendOtp({ intent, intentId, channel }) {
  if (!intentId || !intent) {
    const err = new Error("Missing intentId or intent");
    err.status = 400;
    throw err;
  }

  if (!CHANNELS.has(channel)) {
    const err = new Error("Invalid channel. Use EMAIL or PHONE.");
    err.status = 400;
    throw err;
  }

  const target = resolveTargetFromIntent(intent, channel);
  if (!target) {
    const err = new Error("Missing target on intent");
    err.status = 400;
    throw err;
  }

  if (channel === "PHONE" && !isRwandaMsisdn250(target)) {
    const err = new Error("Invalid phone format on intent. Use 2507XXXXXXXX or 07XXXXXXXX");
    err.status = 400;
    throw err;
  }

  const burned = await isTrialAlreadyBurned({
    email: normalizeEmail(intent.email),
    phone: normalizePhone(intent.phone),
    deviceId: cleanString(intent.deviceId),
    browserFingerprint: cleanString(intent.browserFingerprint),
  });

  if (burned) {
    const err = new Error("Free trial already used. Please choose a paid plan.");
    err.status = 403;
    throw err;
  }

  await assertCooldown(intentId, channel, target);

  const code = generateOtpCode();
  const codeHash = hashOtp({ intentId, channel, target, code });
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const otpRow = await prisma.otpCode.create({
    data: {
      intentId,
      channel,
      target,
      codeHash,
      expiresAt,
    },
    select: { id: true },
  });

  let delivery;
  if (channel === "EMAIL") {
    delivery = await sendEmailOtp({
      to: target,
      code,
      ttlMinutes: OTP_TTL_MINUTES,
    });
  } else {
    delivery = await sendSmsOtp({
      to: target,
      code,
      ttlMinutes: OTP_TTL_MINUTES,
    });
  }

  await logDelivery({
    otpId: otpRow.id,
    intentId,
    channel,
    target,
    provider: delivery?.provider || null,
    status: delivery?.sent ? "SENT" : "FAILED",
    reason: delivery?.sent ? null : delivery?.reason || "UNKNOWN_SEND_FAILURE",
    messageId: delivery?.messageId || null,
    metadata: {
      environment: process.env.NODE_ENV || "development",
      channel,
    },
    deliveredAt: delivery?.sent ? new Date() : null,
  });

  if (process.env.NODE_ENV === "production" && !delivery?.sent) {
    await prisma.otpCode.delete({ where: { id: otpRow.id } });

    const err = new Error(
      channel === "EMAIL" ? "Failed to send email OTP" : "Failed to send SMS OTP"
    );
    err.status = 502;
    err.reason = delivery?.reason || "SEND_FAILED";
    throw err;
  }

  return {
    otpId: otpRow.id,
    channel,
    target,
    expiresAt,
    sent: !!delivery?.sent,
    provider: delivery?.provider || null,
    messageId: delivery?.messageId || null,
    reason: delivery?.sent ? null : delivery?.reason || "SEND_FAILED",
    devOtp: DEV_OTP_ECHO ? code : undefined,
  };
}

module.exports = {
  CHANNELS,
  OTP_TTL_MINUTES,
  cleanString,
  normalizeEmail,
  normalizePhone,
  isRwandaMsisdn250,
  hashOtp,
  resolveTargetFromIntent,
  createAndSendOtp,
};