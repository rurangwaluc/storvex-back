const service = require("./whatsapp.inbox.service");

async function listConversations(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const conversations = await service.listConversations({ tenantId });
    return res.json({ conversations });
  } catch (err) {
    console.error("listConversations error:", err);
    return res.status(500).json({ message: "Failed to list conversations" });
  }
}

async function listMessages(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;
    const result = await service.listMessages({ tenantId, conversationId: id });
    return res.json(result);
  } catch (err) {
    console.error("listMessages error:", err);

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(500).json({ message: "Failed to list messages" });
  }
}

async function reply(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { id } = req.params;
    const { text } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: "text is required" });
    }

    const result = await service.reply({
      tenantId,
      conversationId: id,
      userId,
      text: String(text).trim(),
    });

    return res.json(result);
  } catch (err) {
    console.error("reply error:", err);

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (err.message === "ACCOUNT_INACTIVE") {
      return res.status(400).json({ message: "WhatsApp account is missing or inactive" });
    }

    return res.status(500).json({ message: "Failed to send reply" });
  }
}

async function updateStatus(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id } = req.params;
    const { status } = req.body || {};

    const normalizedStatus = String(status || "").toUpperCase();

    if (!normalizedStatus || !["OPEN", "CLOSED"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "status must be OPEN or CLOSED" });
    }

    const updated = await service.updateStatus({
      tenantId,
      conversationId: id,
      status: normalizedStatus,
    });

    return res.json({ updated });
  } catch (err) {
    console.error("updateStatus error:", err);

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ message: "Conversation not found" });
    }

    return res.status(500).json({ message: "Failed to update status" });
  }
}

async function listSaleDrafts(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const drafts = await service.listSaleDrafts({ tenantId });
    return res.json({ drafts });
  } catch (err) {
    console.error("listSaleDrafts error:", err);
    return res.status(500).json({ message: "Failed to list sale drafts" });
  }
}

async function getSaleDraft(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { saleId } = req.params;

    const draft = await service.getSaleDraft({ tenantId, saleId });
    return res.json({ draft });
  } catch (err) {
    console.error("getSaleDraft error:", err);

    if (err.message === "SALE_DRAFT_NOT_FOUND") {
      return res.status(404).json({ message: "Sale draft not found" });
    }

    return res.status(500).json({ message: "Failed to fetch sale draft" });
  }
}

async function createSaleDraft(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { id } = req.params;

    const result = await service.createSaleDraft({
      tenantId,
      conversationId: id,
      userId,
      body: req.body || {},
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error("createSaleDraft error:", err);

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (err.message === "NO_ITEMS") {
      return res.status(400).json({ message: "items are required" });
    }
    if (err.message === "PRODUCT_ID_REQUIRED") {
      return res.status(400).json({ message: "Each item must have productId" });
    }
    if (err.message === "INVALID_QUANTITY") {
      return res.status(400).json({ message: "quantity must be >= 1" });
    }
    if (err.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "One or more products were not found" });
    }
    if (err.message === "INVALID_DUE_DATE") {
      return res.status(400).json({ message: "Invalid dueDate" });
    }
    if (err.message === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({
        message: "customer.name and customer.phone are required when sending customer object",
      });
    }
    if (err.message === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(500).json({ message: "Failed to create sale draft" });
  }
}

async function updateSaleDraft(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { saleId } = req.params;

    const result = await service.updateSaleDraft({
      tenantId,
      saleId,
      userId,
      body: req.body || {},
    });

    return res.json(result);
  } catch (err) {
    console.error("updateSaleDraft error:", err);

    if (err.message === "SALE_DRAFT_NOT_FOUND") {
      return res.status(404).json({ message: "Sale draft not found" });
    }
    if (err.message === "NO_ITEMS") {
      return res.status(400).json({ message: "items are required" });
    }
    if (err.message === "PRODUCT_ID_REQUIRED") {
      return res.status(400).json({ message: "Each item must have productId" });
    }
    if (err.message === "INVALID_QUANTITY") {
      return res.status(400).json({ message: "quantity must be >= 1" });
    }
    if (err.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "One or more products were not found" });
    }
    if (err.message === "INVALID_DUE_DATE") {
      return res.status(400).json({ message: "Invalid dueDate" });
    }
    if (err.message === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({
        message: "customer.name and customer.phone are required when sending customer object",
      });
    }
    if (err.message === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.status(500).json({ message: "Failed to update sale draft" });
  }
}

async function deleteSaleDraft(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { saleId } = req.params;

    const result = await service.deleteSaleDraft({ tenantId, saleId });
    return res.json(result);
  } catch (err) {
    console.error("deleteSaleDraft error:", err);

    if (err.message === "SALE_DRAFT_NOT_FOUND") {
      return res.status(404).json({ message: "Sale draft not found" });
    }

    return res.status(500).json({ message: "Failed to delete sale draft" });
  }
}

async function finalizeSaleDraft(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const { saleId } = req.params;

    const result = await service.finalizeSaleDraft({
      tenantId,
      saleId,
      userId,
      body: req.body || {},
    });

    return res.json(result);
  } catch (err) {
    console.error("finalizeSaleDraft error:", err);

    if (err.message === "SALE_DRAFT_NOT_FOUND") {
      return res.status(404).json({ message: "Sale draft not found" });
    }
    if (err.message === "NO_ITEMS") {
      return res.status(400).json({ message: "Sale draft has no items to finalize" });
    }
    if (err.message === "INSUFFICIENT_STOCK") {
      return res.status(400).json({ message: "Insufficient stock for one or more items" });
    }
    if (err.message === "INVALID_DUE_DATE") {
      return res.status(400).json({ message: "Invalid dueDate" });
    }
    if (err.message === "PAYMENT_EXCEEDS_TOTAL") {
      return res.status(400).json({ message: "amountPaid cannot exceed total" });
    }
    if (err.message === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({
        message: "customer.name and customer.phone are required when sending customer object",
      });
    }
    if (err.message === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }
    if (err.code === "CASH_DRAWER_CLOSED" || err.message === "CASH_DRAWER_CLOSED") {
      return res.status(409).json({
        message: "Cash drawer is closed. Open drawer to finalize CASH sale.",
        code: "CASH_DRAWER_CLOSED",
      });
    }

    return res.status(500).json({ message: "Failed to finalize sale draft" });
  }
}

module.exports = {
  listConversations,
  listMessages,
  reply,
  updateStatus,
  listSaleDrafts,
  getSaleDraft,
  createSaleDraft,
  updateSaleDraft,
  deleteSaleDraft,
  finalizeSaleDraft,
};