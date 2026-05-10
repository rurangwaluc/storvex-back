const service = require("./whatsapp.inbox.service");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function getBranchIdFromRequest(req) {
  return (
    req.body?.branchId ||
    req.query?.branchId ||
    req.user?.activeBranchId ||
    req.user?.branchId ||
    req.user?.defaultBranchId ||
    null
  );
}

function mapServiceError(err, res, fallbackMessage) {
  const code = err?.code || err?.message;

  if (code === "NOT_FOUND" || code === "CONVERSATION_NOT_FOUND") {
    return res.status(404).json({ message: "Conversation not found", code });
  }

  if (code === "TEXT_REQUIRED") {
    return res.status(400).json({ message: "Text is required", code });
  }

  if (code === "ACCOUNT_INACTIVE") {
    return res.status(400).json({
      message: "WhatsApp account is missing or inactive",
      code,
    });
  }

  if (code === "SALE_DRAFT_NOT_FOUND") {
    return res.status(404).json({ message: "Sale draft not found", code });
  }

  if (code === "SALE_NOT_FOUND") {
    return res.status(404).json({ message: "Sale not found", code });
  }

  if (code === "NO_ITEMS") {
    return res.status(400).json({ message: "Items are required", code });
  }

  if (code === "PRODUCT_ID_REQUIRED") {
    return res.status(400).json({
      message: "Each item must have productId",
      code,
    });
  }

  if (code === "INVALID_QUANTITY") {
    return res.status(400).json({
      message: "Quantity must be greater than or equal to 1",
      code,
    });
  }

  if (code === "PRODUCT_NOT_FOUND") {
    return res.status(404).json({
      message: "One or more products were not found",
      code,
    });
  }

  if (code === "INVALID_DUE_DATE") {
    return res.status(400).json({ message: "Invalid due date", code });
  }

  if (code === "INVALID_CUSTOMER_FIELDS") {
    return res.status(400).json({
      message: "Customer name and customer phone are required",
      code,
    });
  }

  if (code === "CUSTOMER_NOT_FOUND") {
    return res.status(404).json({ message: "Customer not found", code });
  }

  if (code === "PAYMENT_EXCEEDS_TOTAL") {
    return res.status(400).json({
      message: "Amount paid cannot exceed total",
      code,
    });
  }

  if (code === "INSUFFICIENT_STOCK") {
    return res.status(400).json({
      message: err?.productName
        ? `${err.productName} does not have enough stock in this branch`
        : "Insufficient stock for one or more items in this branch",
      code,
      productId: err?.productId || undefined,
      productName: err?.productName || undefined,
      available: err?.available,
      needed: err?.needed,
    });
  }

  if (code === "CASH_DRAWER_CLOSED") {
    return res.status(409).json({
      message:
        "Cash drawer is closed. Open this branch drawer before finalizing a cash WhatsApp sale.",
      code: "CASH_DRAWER_CLOSED",
    });
  }

  if (code === "BRANCH_REQUIRED") {
    return res.status(400).json({
      message: "Choose the branch that owns this WhatsApp sale before continuing",
      code,
    });
  }

  if (code === "BRANCH_NOT_FOUND") {
    return res.status(404).json({
      message: "Branch not found or inactive",
      code,
    });
  }

  if (code === "BRANCH_ACCESS_DENIED") {
    return res.status(403).json({
      message: "You do not have access to this branch",
      code,
    });
  }

  if (code === "INVALID_ARGS") {
    return res.status(400).json({ message: "Invalid request", code });
  }

  if (code === "ASSIGNED_TO_REQUIRED") {
    return res.status(400).json({
      message: "assignedToId is required",
      code,
    });
  }

  if (code === "INVALID_ASSIGNEE") {
    return res.status(400).json({ message: "Invalid assignee", code });
  }

  if (code === "ASSIGNEE_NOT_FOUND") {
    return res.status(404).json({
      message: "Staff member not found or cannot be assigned",
      code,
    });
  }

  console.error("WhatsApp inbox unhandled error:", err);

  return res.status(500).json({
    message: fallbackMessage,
    code: code || "WHATSAPP_INBOX_ERROR",
  });
}

async function listConversations(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    const conversations = await service.listConversations({
      tenantId,
      userId,
    });

    return res.json({
      ok: true,
      conversations,
    });
  } catch (err) {
    console.error("listConversations error:", err);
    return mapServiceError(err, res, "Failed to list conversations");
  }
}

async function listMessages(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;

    const result = await service.listMessages({
      tenantId,
      userId,
      conversationId: id,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("listMessages error:", err);
    return mapServiceError(err, res, "Failed to list messages");
  }
}

async function markConversationRead(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;

    const result = await service.markConversationRead({
      tenantId,
      userId,
      conversationId: id,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("markConversationRead error:", err);
    return mapServiceError(err, res, "Failed to mark conversation as read");
  }
}

async function reply(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;
    const { text } = req.body || {};

    const result = await service.reply({
      tenantId,
      conversationId: id,
      userId,
      text,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("reply error:", err);
    return mapServiceError(err, res, "Failed to send reply");
  }
}

async function updateStatus(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;
    const { status } = req.body || {};

    const normalizedStatus = String(status || "").toUpperCase();

    if (!normalizedStatus || !["OPEN", "CLOSED"].includes(normalizedStatus)) {
      return res.status(400).json({
        message: "Status must be OPEN or CLOSED",
        code: "INVALID_STATUS",
      });
    }

    const updated = await service.updateStatus({
      tenantId,
      conversationId: id,
      status: normalizedStatus,
      userId,
    });

    return res.json({
      ok: true,
      updated,
    });
  } catch (err) {
    console.error("updateStatus error:", err);
    return mapServiceError(err, res, "Failed to update status");
  }
}

async function listAssignableStaff(req, res) {
  try {
    const tenantId = getTenantId(req);

    const staff = await service.listAssignableStaff({
      tenantId,
    });

    return res.json({
      ok: true,
      staff,
    });
  } catch (err) {
    console.error("listAssignableStaff error:", err);
    return mapServiceError(err, res, "Failed to list assignable staff");
  }
}

async function listSaleDrafts(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const branchId = getBranchIdFromRequest(req);

    const drafts = await service.listSaleDrafts({
      tenantId,
      userId,
      branchId,
    });

    return res.json({
      ok: true,
      drafts,
    });
  } catch (err) {
    console.error("listSaleDrafts error:", err);
    return mapServiceError(err, res, "Failed to list sale drafts");
  }
}

async function getSaleDraft(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { saleId } = req.params;

    const draft = await service.getSaleDraft({
      tenantId,
      userId,
      saleId,
    });

    return res.json({
      ok: true,
      draft,
    });
  } catch (err) {
    console.error("getSaleDraft error:", err);
    return mapServiceError(err, res, "Failed to fetch sale draft");
  }
}

async function createSaleDraft(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { id } = req.params;
    const branchId = getBranchIdFromRequest(req);

    const body = {
      ...(req.body || {}),
      ...(branchId ? { branchId } : {}),
    };

    const result = await service.createSaleDraft({
      tenantId,
      conversationId: id,
      userId,
      body,
    });

    return res.status(201).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("createSaleDraft error:", err);
    return mapServiceError(err, res, "Failed to create sale draft");
  }
}

async function updateSaleDraft(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { saleId } = req.params;
    const branchId = getBranchIdFromRequest(req);

    const body = {
      ...(req.body || {}),
      ...(branchId ? { branchId } : {}),
    };

    const result = await service.updateSaleDraft({
      tenantId,
      saleId,
      userId,
      body,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("updateSaleDraft error:", err);
    return mapServiceError(err, res, "Failed to update sale draft");
  }
}

async function deleteSaleDraft(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { saleId } = req.params;

    const result = await service.deleteSaleDraft({
      tenantId,
      saleId,
      userId,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("deleteSaleDraft error:", err);
    return mapServiceError(err, res, "Failed to delete sale draft");
  }
}

async function finalizeSaleDraft(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    const { saleId } = req.params;
    const branchId = getBranchIdFromRequest(req);

    const body = {
      ...(req.body || {}),
      ...(branchId ? { branchId } : {}),
    };

    const result = await service.finalizeSaleDraft({
      tenantId,
      saleId,
      userId,
      body,
    });

    return res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error("finalizeSaleDraft error:", err);
    return mapServiceError(err, res, "Failed to finalize sale draft");
  }
}

async function assignConversation(req, res) {
  try {
    const tenantId = getTenantId(req);
    const actorUserId = getUserId(req);
    const conversationId = req.params?.id;
    const assignedToId = req.body?.assignedToId;

    const result = await service.assignConversation({
      tenantId,
      conversationId,
      assignedToId,
      actorUserId,
    });

    return res.json({
      ok: true,
      message: "Conversation assigned successfully",
      conversation: result.conversation,
    });
  } catch (err) {
    console.error("assignConversation error:", err);
    return mapServiceError(err, res, "Failed to assign conversation");
  }
}

async function unassignConversation(req, res) {
  try {
    const tenantId = getTenantId(req);
    const actorUserId = getUserId(req);
    const conversationId = req.params?.id;

    const result = await service.unassignConversation({
      tenantId,
      conversationId,
      actorUserId,
    });

    return res.json({
      ok: true,
      message: "Conversation unassigned successfully",
      conversation: result.conversation,
    });
  } catch (err) {
    console.error("unassignConversation error:", err);
    return mapServiceError(err, res, "Failed to unassign conversation");
  }
}

module.exports = {
  listConversations,
  listMessages,
  markConversationRead,
  reply,
  updateStatus,
  listAssignableStaff,
  listSaleDrafts,
  getSaleDraft,
  createSaleDraft,
  updateSaleDraft,
  deleteSaleDraft,
  finalizeSaleDraft,
  assignConversation,
  unassignConversation,
};