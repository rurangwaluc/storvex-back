const service = require("./whatsapp.broadcasts.service");

function toPositiveInt(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

async function listBroadcasts(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const broadcasts = await service.listBroadcasts({
      tenantId,
      status: req.query?.status,
      accountId: req.query?.accountId,
      q: req.query?.q,
      limit: toPositiveInt(req.query?.limit, 50),
    });

    return res.json({ broadcasts });
  } catch (err) {
    console.error("listBroadcasts error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    return res.status(500).json({ message: "Failed to list WhatsApp broadcasts" });
  }
}

async function getBroadcast(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { broadcastId } = req.params;

    const broadcast = await service.getBroadcast({
      tenantId,
      broadcastId,
    });

    return res.json({ broadcast });
  } catch (err) {
    console.error("getBroadcast error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.message === "BROADCAST_NOT_FOUND") {
      return res.status(404).json({ message: "Broadcast not found" });
    }

    return res.status(500).json({ message: "Failed to fetch WhatsApp broadcast" });
  }
}

async function createBroadcast(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    const broadcast = await service.createBroadcast({
      tenantId,
      userId,
      body: req.body || {},
    });

    return res.status(201).json({
      created: true,
      broadcast,
    });
  } catch (err) {
    console.error("createBroadcast error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.message === "WHATSAPP_ACCOUNT_NOT_FOUND") {
      return res.status(404).json({ message: "Active WhatsApp account not found" });
    }

    if (err.message === "WHATSAPP_ACCOUNT_PHONE_NUMBER_ID_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the channel number ID",
      });
    }

    if (err.message === "WHATSAPP_ACCOUNT_ACCESS_TOKEN_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the live connection key",
      });
    }

    if (err.message === "PROMOTION_NOT_FOUND") {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (err.message === "TEMPLATE_NAME_REQUIRED") {
      return res.status(400).json({ message: "Template name is required" });
    }

    return res.status(500).json({ message: "Failed to create WhatsApp broadcast" });
  }
}

async function updateBroadcast(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { broadcastId } = req.params;

    const broadcast = await service.updateBroadcast({
      tenantId,
      broadcastId,
      body: req.body || {},
    });

    return res.json({
      updated: true,
      broadcast,
    });
  } catch (err) {
    console.error("updateBroadcast error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.message === "BROADCAST_NOT_FOUND") {
      return res.status(404).json({ message: "Broadcast not found" });
    }

    if (err.message === "ONLY_DRAFT_CAN_BE_EDITED") {
      return res.status(409).json({
        message: "Only a draft broadcast can be edited",
      });
    }

    if (err.message === "WHATSAPP_ACCOUNT_NOT_FOUND") {
      return res.status(404).json({ message: "Active WhatsApp account not found" });
    }

    if (err.message === "WHATSAPP_ACCOUNT_PHONE_NUMBER_ID_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the channel number ID",
      });
    }

    if (err.message === "WHATSAPP_ACCOUNT_ACCESS_TOKEN_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the live connection key",
      });
    }

    if (err.message === "PROMOTION_NOT_FOUND") {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (err.message === "TEMPLATE_NAME_REQUIRED") {
      return res.status(400).json({ message: "Template name is required" });
    }

    return res.status(500).json({ message: "Failed to update WhatsApp broadcast" });
  }
}

async function queueBroadcast(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { broadcastId } = req.params;

    const broadcast = await service.queueBroadcast({
      tenantId,
      broadcastId,
    });

    return res.json({
      queued: true,
      broadcast,
    });
  } catch (err) {
    console.error("queueBroadcast error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.message === "BROADCAST_NOT_FOUND") {
      return res.status(404).json({ message: "Broadcast not found" });
    }

    if (err.message === "ONLY_DRAFT_CAN_BE_QUEUED") {
      return res.status(409).json({
        message: "Only a draft broadcast can be queued",
      });
    }

    return res.status(500).json({ message: "Failed to queue WhatsApp broadcast" });
  }
}

async function sendBroadcastNow(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { broadcastId } = req.params;

    const result = await service.sendBroadcastNow({
      tenantId,
      broadcastId,
      limit: toPositiveInt(req.body?.limit ?? req.query?.limit, 50),
    });

    return res.json({
      sent: true,
      broadcast: result.broadcast,
      summary: result.summary,
    });
  } catch (err) {
    console.error("sendBroadcastNow error:", err);

    if (err.message === "TENANT_NOT_FOUND") {
      return res.status(404).json({ message: "Tenant not found" });
    }

    if (err.message === "BROADCAST_NOT_FOUND") {
      return res.status(404).json({ message: "Broadcast not found" });
    }

    if (err.message === "ONLY_DRAFT_OR_QUEUED_CAN_BE_SENT") {
      return res.status(409).json({
        message: "Only a draft or queued broadcast can be sent",
      });
    }

    if (err.message === "PROMOTION_REQUIRED_TO_SEND") {
      return res.status(400).json({
        message: "This broadcast needs a promotion message before it can be sent",
      });
    }

    if (err.message === "NO_BROADCAST_RECIPIENTS") {
      return res.status(400).json({
        message: "No opted-in customers with WhatsApp numbers were found",
      });
    }

    if (err.message === "WHATSAPP_ACCOUNT_NOT_FOUND") {
      return res.status(404).json({ message: "Active WhatsApp account not found" });
    }

    if (err.message === "WHATSAPP_ACCOUNT_PHONE_NUMBER_ID_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the channel number ID",
      });
    }

    if (err.message === "WHATSAPP_ACCOUNT_ACCESS_TOKEN_MISSING") {
      return res.status(400).json({
        message: "This WhatsApp account is missing the live connection key",
      });
    }

    return res.status(500).json({ message: "Failed to send WhatsApp broadcast" });
  }
}

module.exports = {
  listBroadcasts,
  getBroadcast,
  createBroadcast,
  updateBroadcast,
  queueBroadcast,
  sendBroadcastNow,
};