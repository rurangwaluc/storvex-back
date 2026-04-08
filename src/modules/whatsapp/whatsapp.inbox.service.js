const prisma = require("../../config/database");
const whatsappService = require("./whatsapp.service");
const { reserveSaleDocumentNumbersTx } = require("../documents/documentNumber.service");

function appError(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  const s = String(value || "").trim();
  return s || null;
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizePhoneLoose(value) {
  const s = digitsOnly(value);
  return s || null;
}

function normalizeSaleType(value) {
  const v = String(value || "CREDIT").toUpperCase();
  return v === "CASH" ? "CASH" : "CREDIT";
}

function normalizePaymentMethod(value) {
  const v = String(value || "CASH").toUpperCase();
  if (v === "CASH" || v === "MOMO" || v === "BANK" || v === "OTHER") return v;
  return "CASH";
}

function normalizeConversationStatus(value) {
  const v = String(value || "").toUpperCase();
  if (v === "OPEN" || v === "CLOSED") return v;
  return "OPEN";
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getModelFields(delegate) {
  return delegate?.fields || {};
}

function buildCustomerSelectShape(delegate = prisma.customer) {
  const fields = getModelFields(delegate);
  return {
    id: true,
    name: true,
    phone: true,
    ...(typeof fields.email !== "undefined" ? { email: true } : {}),
    ...(typeof fields.address !== "undefined" ? { address: true } : {}),
    ...(typeof fields.tinNumber !== "undefined" ? { tinNumber: true } : {}),
    ...(typeof fields.idNumber !== "undefined" ? { idNumber: true } : {}),
    ...(typeof fields.notes !== "undefined" ? { notes: true } : {}),
    ...(typeof fields.isActive !== "undefined" ? { isActive: true } : {}),
    ...(typeof fields.whatsappOptIn !== "undefined" ? { whatsappOptIn: true } : {}),
  };
}

function buildDraftItemSelectShape() {
  return {
    id: true,
    saleId: true,
    productId: true,
    quantity: true,
    price: true,
    product: {
      select: {
        id: true,
        name: true,
        sku: true,
        serial: true,
        sellPrice: true,
        stockQty: true,
      },
    },
  };
}

function buildDraftSaleSelectShape(delegate = prisma.sale) {
  const saleFields = getModelFields(delegate);

  return {
    id: true,
    tenantId: true,
    cashierId: true,
    customerId: true,
    total: true,
    saleType: true,
    amountPaid: true,
    balanceDue: true,
    dueDate: true,
    status: true,
    createdAt: true,
    ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
    ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: true } : {}),
    ...(typeof saleFields.finalizedAt !== "undefined" ? { finalizedAt: true } : {}),
    cashier: {
      select: {
        id: true,
        name: true,
      },
    },
    customer: {
      select: buildCustomerSelectShape(),
    },
    items: {
      orderBy: [{ id: "asc" }],
      select: buildDraftItemSelectShape(),
    },
  };
}

function computeSaleStatus({ saleType, total, amountPaid, dueDate }) {
  const t = Number(total) || 0;
  const paid = Number(amountPaid) || 0;
  const balanceDue = Math.max(0, t - paid);

  if (saleType === "CASH") {
    return { status: "PAID", balanceDue: 0 };
  }

  if (balanceDue <= 0) {
    return { status: "PAID", balanceDue: 0 };
  }

  const hasDue = dueDate && !Number.isNaN(new Date(dueDate).getTime());
  const overdue = hasDue && new Date(dueDate) < new Date();

  if (paid > 0) {
    return { status: overdue ? "OVERDUE" : "PARTIAL", balanceDue };
  }

  return { status: overdue ? "OVERDUE" : "UNPAID", balanceDue };
}

async function createAuditLogTx(
  tx,
  { tenantId, userId = null, entity, entityId = null, action, metadata = null }
) {
  try {
    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        entity,
        entityId,
        action,
        metadata,
      },
    });
  } catch (err) {
    console.error("createAuditLogTx error:", err);
  }
}

async function getOpenCashSessionId(tx, tenantId) {
  const rows = await tx.$queryRaw`
    select id
    from public.cash_sessions
    where tenant_id = ${String(tenantId)}::uuid
      and closed_at is null
    order by opened_at desc
    limit 1
  `;
  return rows?.[0]?.id || null;
}

async function insertCashMovementIfPossible(
  tx,
  { tenantId, userId, sessionId, type, reason, amount, note }
) {
  if (!sessionId) return null;

  const amountBigInt = BigInt(Math.round(Number(amount || 0)));

  const rows = await tx.$queryRaw`
    insert into public.cash_movements
      (tenant_id, session_id, type, reason, amount, note, created_by)
    values
      (
        ${String(tenantId)}::uuid,
        ${String(sessionId)}::uuid,
        ${String(type)}::cash_movement_type,
        ${String(reason)}::cash_movement_reason,
        ${amountBigInt},
        ${note},
        ${userId ? String(userId) : null}::uuid
      )
    returning id, type, reason, amount, note, created_at, created_by
  `;

  return rows?.[0] || null;
}

async function tenantBlocksCashSales(db, tenantId) {
  const rows = await db.$queryRaw`
    select cash_drawer_block_cash_sales
    from public."Tenant"
    where id = ${String(tenantId)}::text
    limit 1
  `;
  const v = rows?.[0]?.cash_drawer_block_cash_sales;
  return v == null ? true : Boolean(v);
}

function mapConversationListItem(conversation) {
  const latestMessage = conversation.messages?.[0] || null;

  return {
    id: conversation.id,
    phone: conversation.phone,
    status: conversation.status,
    assignedToId: conversation.assignedToId,
    accountId: conversation.accountId,
    customerId: conversation.customerId,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    customer: conversation.customer || null,
    assignedTo: conversation.assignedTo || null,
    account: conversation.account || null,
    latestMessage: latestMessage
      ? {
          id: latestMessage.id,
          direction: latestMessage.direction,
          type: latestMessage.type,
          textContent: latestMessage.textContent,
          mediaUrl: latestMessage.mediaUrl,
          messageId: latestMessage.messageId || null,
          createdAt: latestMessage.createdAt,
          sentById: latestMessage.sentById || null,
        }
      : null,
    messageCount: Number(conversation._count?.messages || 0),
  };
}

async function listConversations({ tenantId }) {
  const conversations = await prisma.whatsAppConversation.findMany({
    where: { tenantId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      phone: true,
      status: true,
      assignedToId: true,
      accountId: true,
      customerId: true,
      updatedAt: true,
      createdAt: true,
      customer: {
        select: buildCustomerSelectShape(),
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      account: {
        select: {
          id: true,
          phoneNumber: true,
          businessName: true,
          isActive: true,
        },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          direction: true,
          type: true,
          textContent: true,
          mediaUrl: true,
          messageId: true,
          createdAt: true,
          sentById: true,
        },
      },
      _count: {
        select: {
          messages: true,
        },
      },
    },
  });

  return conversations.map(mapConversationListItem);
}

async function listMessages({ tenantId, conversationId }) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      phone: true,
      status: true,
      assignedToId: true,
      accountId: true,
      customerId: true,
      updatedAt: true,
      createdAt: true,
      customer: {
        select: buildCustomerSelectShape(),
      },
      assignedTo: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      account: {
        select: {
          id: true,
          phoneNumber: true,
          businessName: true,
          isActive: true,
        },
      },
    },
  });

  if (!convo) throw appError("NOT_FOUND");

  const messages = await prisma.whatsAppMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      direction: true,
      type: true,
      textContent: true,
      mediaUrl: true,
      messageId: true,
      createdAt: true,
      sentById: true,
    },
  });

  return { conversationId, conversation: convo, messages };
}

async function reply({ tenantId, conversationId, userId, text }) {
  const cleanText = normalizeText(text);
  if (!cleanText) throw appError("TEXT_REQUIRED");

  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      phone: true,
      accountId: true,
    },
  });

  if (!convo) throw appError("NOT_FOUND");

  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: convo.accountId, tenantId, isActive: true },
  });

  if (!account) throw appError("ACCOUNT_INACTIVE");

  const to = normalizePhoneLoose(convo.phone);
  if (!to) throw appError("ACCOUNT_INACTIVE");

  const resp = await whatsappService.sendText({
    account,
    to,
    text: cleanText,
  });

  const metaMsgId = resp?.messages?.[0]?.id || null;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const saved = await tx.whatsAppMessage.create({
      data: {
        conversationId: convo.id,
        tenantId,
        accountId: account.id,
        direction: "OUTBOUND",
        type: "TEXT",
        textContent: cleanText,
        messageId: metaMsgId,
        sentById: userId,
        createdAt: now,
      },
      select: {
        id: true,
        messageId: true,
        createdAt: true,
        textContent: true,
        direction: true,
        type: true,
      },
    });

    await tx.whatsAppConversation.update({
      where: { id: convo.id },
      data: { updatedAt: now },
    });

    await createAuditLogTx(tx, {
      tenantId,
      userId,
      entity: "WHATSAPP_MESSAGE",
      entityId: saved.id,
      action: "WHATSAPP_REPLY_SENT",
      metadata: {
        conversationId: convo.id,
        accountId: account.id,
        phone: convo.phone,
        textLength: cleanText.length,
        providerMessageId: metaMsgId,
      },
    });

    return saved;
  });

  return { sent: true, message: result };
}

async function updateStatus({ tenantId, conversationId, status, userId = null }) {
  const normalizedStatus = normalizeConversationStatus(status);

  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, status: true },
  });

  if (!convo) throw appError("NOT_FOUND");

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.whatsAppConversation.update({
      where: { id: conversationId },
      data: { status: normalizedStatus, updatedAt: new Date() },
      select: { id: true, status: true, updatedAt: true },
    });

    await createAuditLogTx(tx, {
      tenantId,
      userId,
      entity: "WHATSAPP_CONVERSATION",
      entityId: row.id,
      action: "WHATSAPP_CONVERSATION_STATUS_UPDATED",
      metadata: {
        previousStatus: convo.status,
        nextStatus: normalizedStatus,
      },
    });

    return row;
  });

  return updated;
}

async function resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer, conversation }) {
  const customerFields = getModelFields(tx.customer);

  if (customerId) {
    const existing = await tx.customer.findFirst({
      where: {
        id: String(customerId),
        tenantId,
        ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
      },
      select: { id: true },
    });

    if (!existing) throw appError("CUSTOMER_NOT_FOUND");
    return existing.id;
  }

  let payload = customer || null;

  if (!payload && conversation) {
    const fallbackPhone = normalizePhone(conversation.phone);
    const fallbackName = normalizeText(conversation.customer?.name) || fallbackPhone;

    if (fallbackPhone) {
      payload = {
        name: fallbackName,
        phone: fallbackPhone,
      };
    }
  }

  if (!payload) return null;

  const cleanName = normalizeText(payload.name);
  const cleanPhone = normalizePhone(payload.phone);
  const cleanEmail = normalizeText(payload.email);
  const cleanAddress = normalizeText(payload.address);
  const cleanTinNumber = normalizeText(payload.tinNumber);
  const cleanIdNumber = normalizeText(payload.idNumber);
  const cleanNotes = normalizeText(payload.notes);

  if (!cleanName || !cleanPhone) {
    throw appError("INVALID_CUSTOMER_FIELDS");
  }

  const existing = await tx.customer.findFirst({
    where: {
      tenantId,
      phone: cleanPhone,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      ...(typeof customerFields.email !== "undefined" ? { email: true } : {}),
      ...(typeof customerFields.address !== "undefined" ? { address: true } : {}),
      ...(typeof customerFields.tinNumber !== "undefined" ? { tinNumber: true } : {}),
      ...(typeof customerFields.idNumber !== "undefined" ? { idNumber: true } : {}),
      ...(typeof customerFields.notes !== "undefined" ? { notes: true } : {}),
      ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
      ...(typeof customerFields.whatsappOptIn !== "undefined" ? { whatsappOptIn: true } : {}),
    },
  });

  if (existing) {
    const updateData = {
      ...(cleanName && cleanName !== existing.name ? { name: cleanName } : {}),
      ...(typeof customerFields.email !== "undefined" &&
      cleanEmail !== (existing.email ?? null)
        ? { email: cleanEmail }
        : {}),
      ...(typeof customerFields.address !== "undefined" &&
      cleanAddress !== (existing.address ?? null)
        ? { address: cleanAddress }
        : {}),
      ...(typeof customerFields.tinNumber !== "undefined" &&
      cleanTinNumber !== (existing.tinNumber ?? null)
        ? { tinNumber: cleanTinNumber }
        : {}),
      ...(typeof customerFields.idNumber !== "undefined" &&
      cleanIdNumber !== (existing.idNumber ?? null)
        ? { idNumber: cleanIdNumber }
        : {}),
      ...(typeof customerFields.notes !== "undefined" &&
      cleanNotes !== (existing.notes ?? null)
        ? { notes: cleanNotes }
        : {}),
      ...(typeof customerFields.isActive !== "undefined" && existing.isActive === false
        ? { isActive: true }
        : {}),
      ...(typeof customerFields.whatsappOptIn !== "undefined" && existing.whatsappOptIn === false
        ? { whatsappOptIn: true }
        : {}),
    };

    if (Object.keys(updateData).length > 0) {
      await tx.customer.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    return existing.id;
  }

  const createData = {
    tenantId,
    name: cleanName,
    phone: cleanPhone,
    ...(typeof customerFields.email !== "undefined" ? { email: cleanEmail } : {}),
    ...(typeof customerFields.address !== "undefined" ? { address: cleanAddress } : {}),
    ...(typeof customerFields.tinNumber !== "undefined" ? { tinNumber: cleanTinNumber } : {}),
    ...(typeof customerFields.idNumber !== "undefined" ? { idNumber: cleanIdNumber } : {}),
    ...(typeof customerFields.notes !== "undefined" ? { notes: cleanNotes } : {}),
    ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
    ...(typeof customerFields.whatsappOptIn !== "undefined"
      ? { whatsappOptIn: Boolean(conversation?.phone) }
      : {}),
  };

  const created = await tx.customer.create({
    data: createData,
    select: { id: true },
  });

  return created.id;
}

async function getSaleDraftTx(tx, tenantId, saleId) {
  const saleFields = getModelFields(tx.sale);

  const draft = await tx.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    select: buildDraftSaleSelectShape(tx.sale),
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");
  return draft;
}

async function recomputeDraftTotalsTx(tx, tenantId, saleId) {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleType: true,
      dueDate: true,
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          quantity: true,
          price: true,
        },
      },
    },
  });

  if (!sale) throw appError("SALE_NOT_FOUND");

  let total = 0;
  for (const item of sale.items || []) {
    total += Number(item.price || 0) * Number(item.quantity || 0);
  }

  const { status, balanceDue } = computeSaleStatus({
    saleType: sale.saleType,
    total,
    amountPaid: 0,
    dueDate: sale.saleType === "CREDIT" ? sale.dueDate : null,
  });

  await tx.sale.update({
    where: { id: saleId },
    data: {
      total,
      amountPaid: 0,
      balanceDue,
      status,
    },
  });

  return getSaleDraftTx(tx, tenantId, saleId);
}

async function listSaleDrafts({ tenantId }) {
  const saleFields = getModelFields(prisma.sale);

  return prisma.sale.findMany({
    where: {
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    orderBy: { createdAt: "desc" },
    select: buildDraftSaleSelectShape(prisma.sale),
  });
}

async function getSaleDraft({ tenantId, saleId }) {
  return getSaleDraftTx(prisma, tenantId, saleId);
}

async function createSaleDraft({ tenantId, conversationId, userId, body }) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      phone: true,
      customerId: true,
      assignedToId: true,
      tenantId: true,
      customer: {
        select: buildCustomerSelectShape(),
      },
    },
  });

  if (!convo) throw appError("NOT_FOUND");

  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) throw appError("NO_ITEMS");

  for (const item of items) {
    if (!item?.productId) throw appError("PRODUCT_ID_REQUIRED");
    const qty = toInt(item.quantity, NaN);
    if (!Number.isInteger(qty) || qty <= 0) throw appError("INVALID_QUANTITY");
  }

  const requestedSaleType = normalizeSaleType(body?.saleType || "CREDIT");
  const parsedDueDate = body?.dueDate ? safeDate(body.dueDate) : null;
  if (body?.dueDate && !parsedDueDate) throw appError("INVALID_DUE_DATE");

  return prisma.$transaction(async (tx) => {
    const resolvedCustomerId = await resolveOrCreateCustomerTx(tx, tenantId, {
      customerId: body?.customerId || convo.customerId || null,
      customer: body?.customer || null,
      conversation: convo,
    });

    if (resolvedCustomerId && !convo.customerId) {
      await tx.whatsAppConversation.update({
        where: { id: convo.id },
        data: { customerId: resolvedCustomerId },
      });
    }

    const productIds = items.map((i) => String(i.productId));
    const products = await tx.product.findMany({
      where: {
        tenantId,
        id: { in: productIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sellPrice: true,
        stockQty: true,
        sku: true,
        serial: true,
      },
    });

    const byId = new Map(products.map((p) => [p.id, p]));

    for (const item of items) {
      const pid = String(item.productId);
      if (!byId.has(pid)) throw appError("PRODUCT_NOT_FOUND");
    }

    let total = 0;
    const normalizedItems = [];

    for (const item of items) {
      const pid = String(item.productId);
      const qty = toInt(item.quantity);
      const product = byId.get(pid);

      const unitPriceRaw = toNumber(item.unitPrice, NaN);
      const unitPrice =
        Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
          ? unitPriceRaw
          : Number(product.sellPrice || 0);

      total += unitPrice * qty;

      normalizedItems.push({
        productId: pid,
        quantity: qty,
        unitPrice,
      });
    }

    const { status, balanceDue } = computeSaleStatus({
      saleType: requestedSaleType,
      total,
      amountPaid: 0,
      dueDate: requestedSaleType === "CREDIT" ? parsedDueDate : null,
    });

    const saleFields = getModelFields(tx.sale);
    const draftCashierId = convo.assignedToId || userId;

    const sale = await tx.sale.create({
      data: {
        tenantId,
        cashierId: draftCashierId,
        customerId: resolvedCustomerId || null,
        total,
        saleType: requestedSaleType,
        amountPaid: 0,
        balanceDue,
        status,
        dueDate: requestedSaleType === "CREDIT" ? parsedDueDate : null,
        conversationId: convo.id,
        ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
        ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      },
      select: {
        id: true,
      },
    });

    for (const row of normalizedItems) {
      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: row.productId,
          quantity: row.quantity,
          price: row.unitPrice,
        },
      });
    }

    await createAuditLogTx(tx, {
      tenantId,
      userId,
      entity: "SALE",
      entityId: sale.id,
      action: "WHATSAPP_SALE_DRAFT_CREATED",
      metadata: {
        source: "WHATSAPP",
        conversationId: convo.id,
        itemCount: normalizedItems.length,
        saleType: requestedSaleType,
        total,
        customerId: resolvedCustomerId,
      },
    });

    const draft = await getSaleDraftTx(tx, tenantId, sale.id);
    return { created: true, draft };
  });
}

async function updateSaleDraft({ tenantId, saleId, userId, body }) {
  const saleFields = getModelFields(prisma.sale);

  const draft = await prisma.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    select: {
      id: true,
      tenantId: true,
      customerId: true,
      saleType: true,
      dueDate: true,
    },
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    let resolvedCustomerId = draft.customerId || null;

    if (body?.customerId || body?.customer) {
      resolvedCustomerId = await resolveOrCreateCustomerTx(tx, tenantId, {
        customerId: body?.customerId || null,
        customer: body?.customer || null,
        conversation: null,
      });
    }

    const patch = {};

    if (body?.saleType !== undefined) {
      patch.saleType = normalizeSaleType(body.saleType);
    }

    if (body?.dueDate !== undefined) {
      if (!body.dueDate) {
        patch.dueDate = null;
      } else {
        const parsedDueDate = safeDate(body.dueDate);
        if (!parsedDueDate) throw appError("INVALID_DUE_DATE");
        patch.dueDate = parsedDueDate;
      }
    }

    if (resolvedCustomerId !== draft.customerId) {
      patch.customerId = resolvedCustomerId || null;
    }

    if (Object.keys(patch).length > 0) {
      await tx.sale.update({
        where: { id: draft.id },
        data: patch,
      });
    }

    if (body?.items !== undefined) {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) throw appError("NO_ITEMS");

      for (const item of items) {
        if (!item?.productId) throw appError("PRODUCT_ID_REQUIRED");
        const qty = toInt(item.quantity, NaN);
        if (!Number.isInteger(qty) || qty <= 0) throw appError("INVALID_QUANTITY");
      }

      const productIds = items.map((i) => String(i.productId));
      const products = await tx.product.findMany({
        where: {
          tenantId,
          id: { in: productIds },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          sellPrice: true,
          stockQty: true,
          sku: true,
          serial: true,
        },
      });

      const byId = new Map(products.map((p) => [p.id, p]));

      for (const item of items) {
        const pid = String(item.productId);
        if (!byId.has(pid)) throw appError("PRODUCT_NOT_FOUND");
      }

      await tx.saleItem.deleteMany({
        where: { saleId: draft.id },
      });

      for (const item of items) {
        const pid = String(item.productId);
        const qty = toInt(item.quantity);
        const product = byId.get(pid);

        const unitPriceRaw = toNumber(item.unitPrice, NaN);
        const unitPrice =
          Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
            ? unitPriceRaw
            : Number(product.sellPrice || 0);

        await tx.saleItem.create({
          data: {
            saleId: draft.id,
            productId: pid,
            quantity: qty,
            price: unitPrice,
          },
        });
      }
    }

    const recomputed = await recomputeDraftTotalsTx(tx, tenantId, draft.id);

    await createAuditLogTx(tx, {
      tenantId,
      userId,
      entity: "SALE",
      entityId: draft.id,
      action: "WHATSAPP_SALE_DRAFT_UPDATED",
      metadata: {
        source: "WHATSAPP",
        hasItemsPatch: body?.items !== undefined,
        hasCustomerPatch: Boolean(body?.customerId || body?.customer),
        hasSaleTypePatch: body?.saleType !== undefined,
        hasDueDatePatch: body?.dueDate !== undefined,
      },
    });

    return { updated: true, draft: recomputed };
  });
}

async function deleteSaleDraft({ tenantId, saleId, userId = null }) {
  const saleFields = getModelFields(prisma.sale);

  const draft = await prisma.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    select: {
      id: true,
      conversationId: true,
    },
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.saleItem.deleteMany({
      where: { saleId: draft.id },
    });

    await tx.sale.delete({
      where: { id: draft.id },
    });

    await createAuditLogTx(tx, {
      tenantId,
      userId,
      entity: "SALE",
      entityId: draft.id,
      action: "WHATSAPP_SALE_DRAFT_DELETED",
      metadata: {
        source: "WHATSAPP",
        conversationId: draft.conversationId || null,
      },
    });
  });

  return { deleted: true, saleId: draft.id };
}

async function finalizeSaleDraft({ tenantId, saleId, userId, body }) {
  const saleFields = getModelFields(prisma.sale);

  const draft = await prisma.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    select: {
      id: true,
      tenantId: true,
      total: true,
      saleType: true,
      dueDate: true,
      customerId: true,
      conversationId: true,
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          productId: true,
          quantity: true,
          price: true,
        },
      },
    },
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");
  if (!draft.items || draft.items.length === 0) throw appError("NO_ITEMS");

  const finalSaleType = normalizeSaleType(body?.saleType || draft.saleType || "CREDIT");
  const method = normalizePaymentMethod(body?.paymentMethod || body?.method || "CASH");

  const parsedDueDate =
    body?.dueDate !== undefined
      ? body.dueDate
        ? safeDate(body.dueDate)
        : null
      : draft.dueDate || null;

  if (body?.dueDate && !parsedDueDate) {
    throw appError("INVALID_DUE_DATE");
  }

  const requestedPaid = Math.max(0, toNumber(body?.amountPaid, 0));
  const initialPaid =
    finalSaleType === "CASH" ? Number(draft.total) : Math.min(requestedPaid, Number(draft.total));

  if (finalSaleType === "CREDIT" && initialPaid > Number(draft.total) + 0.000001) {
    throw appError("PAYMENT_EXCEEDS_TOTAL");
  }

  if (finalSaleType === "CASH") {
    const blockCashSales = await tenantBlocksCashSales(prisma, tenantId);
    if (blockCashSales) {
      const openSessionId = await getOpenCashSessionId(prisma, tenantId);
      if (!openSessionId) {
        throw appError("CASH_DRAWER_CLOSED", { code: "CASH_DRAWER_CLOSED" });
      }
    }
  }

  const productIds = draft.items.map((it) => it.productId);
  const products = await prisma.product.findMany({
    where: { tenantId, id: { in: productIds }, isActive: true },
    select: { id: true, name: true, stockQty: true },
  });

  const byId = new Map(products.map((p) => [p.id, p]));

  for (const it of draft.items) {
    const p = byId.get(it.productId);
    if (!p || Number(p.stockQty || 0) < Number(it.quantity || 0)) {
      throw appError("INSUFFICIENT_STOCK");
    }
  }

  return prisma.$transaction(
    async (tx) => {
      let resolvedCustomerId = draft.customerId || null;

      if (body?.customerId || body?.customer) {
        resolvedCustomerId = await resolveOrCreateCustomerTx(tx, tenantId, {
          customerId: body?.customerId || null,
          customer: body?.customer || null,
          conversation: null,
        });
      }

      for (const it of draft.items) {
        const updated = await tx.product.updateMany({
          where: {
            id: it.productId,
            tenantId,
            isActive: true,
            stockQty: { gte: it.quantity },
          },
          data: { stockQty: { decrement: it.quantity } },
        });

        if (!updated || updated.count !== 1) {
          throw appError("INSUFFICIENT_STOCK");
        }
      }

      const finalizedAt = new Date();
      const doc = await reserveSaleDocumentNumbersTx(tx, {
        tenantId,
        createdAt: finalizedAt,
      });

      const { status, balanceDue } = computeSaleStatus({
        saleType: finalSaleType,
        total: draft.total,
        amountPaid: initialPaid,
        dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
      });

      const updatedSale = await tx.sale.update({
        where: { id: draft.id },
        data: {
          customerId: resolvedCustomerId || null,
          saleType: finalSaleType,
          amountPaid: initialPaid,
          balanceDue,
          status,
          dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
          receiptNumber: doc.receiptNumber,
          invoiceNumber: doc.invoiceNumber,
          ...(typeof getModelFields(tx.sale).isDraft !== "undefined" ? { isDraft: false } : {}),
          ...(typeof getModelFields(tx.sale).draftSource !== "undefined"
            ? { draftSource: null }
            : {}),
          ...(typeof getModelFields(tx.sale).finalizedAt !== "undefined"
            ? { finalizedAt }
            : {}),
        },
        select: {
          id: true,
          saleType: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          status: true,
          dueDate: true,
          receiptNumber: true,
          invoiceNumber: true,
          customerId: true,
          createdAt: true,
          conversationId: true,
          ...(typeof getModelFields(tx.sale).isDraft !== "undefined" ? { isDraft: true } : {}),
          ...(typeof getModelFields(tx.sale).draftSource !== "undefined"
            ? { draftSource: true }
            : {}),
          ...(typeof getModelFields(tx.sale).finalizedAt !== "undefined"
            ? { finalizedAt: true }
            : {}),
        },
      });

      let payment = null;
      let movement = null;

      if (initialPaid > 0) {
        const noteBase = normalizeText(body?.note);
        const safeNote = noteBase
          ? `${noteBase} • ${draft.id} • ${Date.now()}`
          : `WhatsApp payment • ${draft.id} • ${Date.now()}`;

        payment = await tx.salePayment.create({
          data: {
            saleId: draft.id,
            tenantId,
            receivedById: userId || null,
            amount: initialPaid,
            method,
            note: safeNote,
          },
          select: { id: true, amount: true, method: true, createdAt: true, note: true },
        });

        if (method === "CASH") {
          const openSessionId = await getOpenCashSessionId(tx, tenantId);
          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            userId,
            sessionId: openSessionId,
            type: "IN",
            reason: finalSaleType === "CASH" ? "OTHER" : "DEPOSIT",
            amount: initialPaid,
            note:
              finalSaleType === "CASH"
                ? `Cash sale ${draft.id} from WhatsApp`
                : `Credit deposit ${draft.id} from WhatsApp`,
          });
        }
      }

      await createAuditLogTx(tx, {
        tenantId,
        userId,
        entity: "SALE",
        entityId: draft.id,
        action: "WHATSAPP_SALE_DRAFT_FINALIZED",
        metadata: {
          source: "WHATSAPP",
          conversationId: draft.conversationId || null,
          saleType: finalSaleType,
          total: draft.total,
          amountPaid: initialPaid,
          paymentMethod: initialPaid > 0 ? method : null,
          receiptNumber: updatedSale.receiptNumber || null,
          invoiceNumber: updatedSale.invoiceNumber || null,
          customerId: resolvedCustomerId || null,
        },
      });

      return {
        finalized: true,
        sale: updatedSale,
        payment,
        cashMovement: movement
          ? {
              id: movement.id,
              type: movement.type,
              reason: movement.reason,
              amount: String(movement.amount),
              note: movement.note,
              createdAt: movement.created_at,
              createdBy: movement.created_by,
            }
          : null,
      };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );
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