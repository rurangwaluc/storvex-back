const whatsappService = require("./whatsapp.service");

function getRawBody(req) {
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
    return req.rawBody;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }

  if (req.body && typeof req.body === "object") {
    try {
      return Buffer.from(JSON.stringify(req.body), "utf8");
    } catch {
      return null;
    }
  }

  return null;
}

function parseJsonFromRawBody(rawBody) {
  if (!rawBody || !Buffer.isBuffer(rawBody)) return null;

  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
}

function getWebhookBody(req, rawBody) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  return parseJsonFromRawBody(rawBody);
}

function mapWebhookError(err, res) {
  const message = err?.message || err?.code || "Webhook processing failed";

  if (message === "Missing WHATSAPP_APP_SECRET") {
    return res.status(500).json({
      ok: false,
      message: "WhatsApp app secret is not configured",
      code: "WHATSAPP_APP_SECRET_MISSING",
    });
  }

  if (message === "Missing WHATSAPP_VERIFY_TOKEN") {
    return res.status(500).json({
      ok: false,
      message: "WhatsApp verify token is not configured",
      code: "WHATSAPP_VERIFY_TOKEN_MISSING",
    });
  }

  if (message === "Missing WHATSAPP_APP_SECRET" || message === "WHATSAPP_APP_SECRET_MISSING") {
    return res.status(500).json({
      ok: false,
      message: "WhatsApp app secret is not configured",
      code: "WHATSAPP_APP_SECRET_MISSING",
    });
  }

  if (message === "Missing WHATSAPP_VERIFY_TOKEN" || message === "WHATSAPP_VERIFY_TOKEN_MISSING") {
    return res.status(500).json({
      ok: false,
      message: "WhatsApp verify token is not configured",
      code: "WHATSAPP_VERIFY_TOKEN_MISSING",
    });
  }

  console.error("WhatsApp webhook unhandled error:", err);

  return res.status(500).json({
    ok: false,
    message: "Webhook processing failed",
    code: "WHATSAPP_WEBHOOK_ERROR",
  });
}

/**
 * GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *
 * Meta calls this endpoint when verifying the webhook URL.
 */
async function verifyWebhook(req, res) {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode !== "subscribe") {
      return res.status(400).send("Invalid hub.mode");
    }

    const ok = whatsappService.verifyToken(token);

    if (!ok) {
      return res.status(403).send("Forbidden");
    }

    return res.status(200).send(String(challenge || ""));
  } catch (err) {
    console.error("verifyWebhook error:", err);
    return mapWebhookError(err, res);
  }
}

/**
 * POST /api/whatsapp/webhook
 *
 * Meta calls this endpoint for inbound WhatsApp events.
 *
 * Important:
 * - This route must stay public.
 * - Signature verification is handled by whatsapp.service.processWebhookPayload().
 * - The route must respond quickly so Meta does not retry unnecessarily.
 */
async function receiveWebhook(req, res) {
  try {
    const rawBody = getRawBody(req);

    if (!rawBody) {
      return res.status(400).json({
        ok: false,
        message: "Missing raw webhook body",
        code: "RAW_BODY_MISSING",
      });
    }

    const body = getWebhookBody(req, rawBody);

    if (!body) {
      return res.status(400).json({
        ok: false,
        message: "Invalid webhook JSON body",
        code: "INVALID_WEBHOOK_JSON",
      });
    }

    await whatsappService.processWebhookPayload({
      headers: req.headers,
      rawBody,
      body,
    });

    return res.status(200).json({
      ok: true,
      received: true,
    });
  } catch (err) {
    console.error("receiveWebhook error:", err);
    return mapWebhookError(err, res);
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};