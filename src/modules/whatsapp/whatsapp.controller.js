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

// GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
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
    return res.status(500).send("Webhook verification failed");
  }
}

// POST /api/whatsapp/webhook
async function receiveWebhook(req, res) {
  try {
    const rawBody = getRawBody(req);

    if (!rawBody) {
      return res.status(400).json({ message: "Missing raw webhook body" });
    }

    const body =
      req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)
        ? req.body
        : parseJsonFromRawBody(rawBody);

    if (!body) {
      return res.status(400).json({ message: "Invalid webhook JSON body" });
    }

    await whatsappService.processWebhookPayload({
      headers: req.headers,
      rawBody,
      body,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("receiveWebhook error:", err);

    if (err?.message === "Missing WHATSAPP_APP_SECRET") {
      return res.status(500).json({ message: "WhatsApp app secret is not configured" });
    }

    if (err?.message === "Missing WHATSAPP_VERIFY_TOKEN") {
      return res.status(500).json({ message: "WhatsApp verify token is not configured" });
    }

    return res.status(500).json({ message: "Webhook processing failed" });
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};