// src/modules/notifications/sms.provider.js

function isDevEchoEnabled() {
  return String(process.env.DEV_OTP_ECHO || "false").toLowerCase() === "true";
}

function normalizeRwToE164(phone) {
  const raw = String(phone || "").trim().replace(/[^\d]/g, "");
  if (!raw) return null;

  if (raw.startsWith("07") && raw.length === 10) return `+250${raw.slice(1)}`;
  if (raw.startsWith("2507") && raw.length === 12) return `+${raw}`;
  if (/^2507\d{8}$/.test(raw)) return `+${raw}`;

  return null;
}

let twilioClient = null;

function getTwilioClient() {
  if (twilioClient) return twilioClient;

  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();

  if (!accountSid || !authToken) return null;

  const twilio = require("twilio");
  twilioClient = twilio(accountSid, authToken);
  return twilioClient;
}

function buildSmsText(code, ttlMinutes) {
  return `Storvex code: ${code}. Expires in ${ttlMinutes} min.`;
}

function logTwilioError(err) {
  try {
    const safe = {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
    };
    console.error("Twilio error:", JSON.stringify(safe, null, 2));
  } catch (_) {
    console.error("Twilio error:", err?.message || err);
  }
}

async function sendViaTwilio({ toE164, text }) {
  const client = getTwilioClient();
  if (!client) {
    return { sent: false, reason: "TWILIO_NOT_CONFIGURED", provider: "TWILIO" };
  }

  const from = String(process.env.TWILIO_PHONE_NUMBER || "").trim();
  const messagingServiceSid = String(process.env.TWILIO_MESSAGING_SERVICE_SID || "").trim();

  if (!from && !messagingServiceSid) {
    return {
      sent: false,
      reason: "TWILIO_SENDER_NOT_CONFIGURED",
      provider: "TWILIO",
    };
  }

  const payload = {
    to: toE164,
    body: text,
  };

  if (messagingServiceSid) {
    payload.messagingServiceSid = messagingServiceSid;
  } else {
    payload.from = from;
  }

  try {
    const result = await client.messages.create(payload);

    return {
      sent: true,
      provider: "TWILIO",
      messageId: result?.sid || null,
      status: result?.status || null,
    };
  } catch (err) {
    logTwilioError(err);

    // Common useful reason mapping for trial/dev visibility
    if (err?.code === 21608) {
      return {
        sent: false,
        reason: "TWILIO_TRIAL_UNVERIFIED_TO_NUMBER",
        provider: "TWILIO",
        messageId: null,
      };
    }

    return {
      sent: false,
      reason: `TWILIO_SEND_FAILED${err?.code ? `_${err.code}` : ""}`,
      provider: "TWILIO",
      messageId: null,
    };
  }
}

async function sendSmsOtp({ to, code, ttlMinutes }) {
  if (process.env.NODE_ENV !== "production" && isDevEchoEnabled()) {
    console.log("DEV SMS OTP:", { to, code });
    return { sent: true, provider: "DEV_ECHO", messageId: null };
  }

  const provider = String(process.env.SMS_PROVIDER || "TWILIO").trim().toUpperCase();
  const toE164 = normalizeRwToE164(to);

  if (!toE164) {
    return { sent: false, reason: "INVALID_PHONE_FORMAT", provider };
  }

  const text = buildSmsText(code, ttlMinutes);

  if (provider === "TWILIO") {
    return sendViaTwilio({ toE164, text });
  }

  return {
    sent: false,
    reason: `UNSUPPORTED_SMS_PROVIDER_${provider}`,
    provider,
    messageId: null,
  };
}

module.exports = { sendSmsOtp };