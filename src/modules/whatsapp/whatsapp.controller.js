const whatsappService = require("./whatsapp.service");

// GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
async function verifyWebhook(req, res) {
  try {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const ok = whatsappService.verifyToken(token);

    if (mode === "subscribe" && ok) {
      return res.status(200).send(String(challenge || ""));
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error("verifyWebhook error:", err);
    return res.sendStatus(500);
  }
}

// POST /api/whatsapp/webhook
async function receiveWebhook(req, res) {
  try {
    res.sendStatus(200);

    const headers = req.headers;
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "");

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch (e) {
      console.error("WHATSAPP: invalid JSON body");
      return;
    }

    setImmediate(async () => {
      try {
        await whatsappService.processWebhookPayload({ headers, rawBody, body });
      } catch (err) {
        console.error("processWebhookPayload async error:", err);
      }
    });
  } catch (err) {
    console.error("receiveWebhook error:", err);
  }
}

module.exports = {
  verifyWebhook,
  receiveWebhook,
};