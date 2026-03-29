// src/modules/notifications/email.provider.js
let ResendCtor = null;

try {
  const { Resend } = require("resend");
  ResendCtor = Resend;
} catch (_) {
  // resend not installed
}

function isDevEchoEnabled() {
  return String(process.env.DEV_OTP_ECHO || "false").toLowerCase() === "true";
}

function buildEmailText(code, ttlMinutes) {
  return [
    `Your Storvex verification code is: ${code}`,
    "",
    `This code expires in ${ttlMinutes} minutes.`,
    "",
    "If you did not request this code, ignore this email.",
  ].join("\n");
}

function buildEmailHtml(code, ttlMinutes) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px;">Storvex verification code</h2>
      <p style="margin:0 0 12px;">Use this code to continue your signup:</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:12px 0;">
        ${code}
      </div>
      <p style="margin:12px 0;">This code expires in ${ttlMinutes} minutes.</p>
      <p style="margin:12px 0;color:#666;">If you did not request this code, ignore this email.</p>
    </div>
  `;
}

async function sendEmailOtp({ to, code, ttlMinutes }) {
  if (process.env.NODE_ENV !== "production" && isDevEchoEnabled()) {
    console.log("DEV EMAIL OTP:", { to, code });
    return { sent: true, provider: "DEV_ECHO", messageId: null };
  }

  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.RESEND_FROM || "").trim();

  if (!apiKey || !from) {
    return { sent: false, reason: "RESEND_NOT_CONFIGURED", provider: "RESEND" };
  }

  if (!ResendCtor) {
    return { sent: false, reason: "RESEND_SDK_NOT_INSTALLED", provider: "RESEND" };
  }

  try {
    const resend = new ResendCtor(apiKey);

    const response = await resend.emails.send({
      from,
      to,
      subject: "Storvex verification code",
      text: buildEmailText(code, ttlMinutes),
      html: buildEmailHtml(code, ttlMinutes),
    });

    const messageId =
      response?.data?.id ||
      response?.id ||
      null;

    return {
      sent: true,
      provider: "RESEND",
      messageId,
    };
  } catch (err) {
    console.error("Resend send failed:", err?.message || err);
    return {
      sent: false,
      reason: "RESEND_SEND_FAILED",
      provider: "RESEND",
      messageId: null,
    };
  }
}

module.exports = { sendEmailOtp };