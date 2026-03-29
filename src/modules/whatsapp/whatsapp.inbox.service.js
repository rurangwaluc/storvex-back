const prisma = require("../../config/database");
const whatsappService = require("./whatsapp.service");
const { reserveSaleDocumentNumbersTx } = require("../documents/documentNumber.service");

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

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
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

function buildCustomerSelectShape() {
  const fields = prisma.customer.fields || {};
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

function buildDraftSaleSelectShape() {
  const saleFields = prisma.sale.fields || {};
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

async function listConversations({ tenantId }) {
  return prisma.whatsAppConversation.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
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
    },
  });
}

async function listMessages({ tenantId, conversationId }) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });

  if (!convo) throw new Error("NOT_FOUND");

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

  return { conversationId, messages };
}

async function reply({ tenantId, conversationId, userId, text }) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      phone: true,
      accountId: true,
    },
  });

  if (!convo) throw new Error("NOT_FOUND");

  const account = await prisma.whatsAppAccount.findFirst({
    where: { id: convo.accountId, tenantId, isActive: true },
  });

  if (!account) throw new Error("ACCOUNT_INACTIVE");

  const to = normalizePhoneLoose(convo.phone);
  if (!to) throw new Error("ACCOUNT_INACTIVE");

  const resp = await whatsappService.sendText({ account, to, text });
  const metaMsgId = resp?.messages?.[0]?.id || null;

  const saved = await prisma.whatsAppMessage.create({
    data: {
      conversationId: convo.id,
      tenantId,
      accountId: account.id,
      direction: "OUTBOUND",
      type: "TEXT",
      textContent: text,
      messageId: metaMsgId,
      sentById: userId,
      createdAt: new Date(),
    },
    select: { id: true, messageId: true, createdAt: true },
  });

  await prisma.whatsAppConversation.update({
    where: { id: convo.id },
    data: { updatedAt: new Date() },
  });

  return { sent: true, message: saved };
}

async function updateStatus({ tenantId, conversationId, status }) {
  const convo = await prisma.whatsAppConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true },
  });

  if (!convo) throw new Error("NOT_FOUND");

  return prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { status, updatedAt: new Date() },
    select: { id: true, status: true, updatedAt: true },
  });
}

async function resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer, conversation }) {
  const customerFields = tx.customer.fields || {};

  if (customerId) {
    const existing = await tx.customer.findFirst({
      where: {
        id: String(customerId),
        tenantId,
        ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
      },
      select: { id: true },
    });

    if (!existing) throw new Error("CUSTOMER_NOT_FOUND");
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
    throw new Error("INVALID_CUSTOMER_FIELDS");
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
  const saleFields = tx.sale.fields || {};

  const draft = await tx.sale.findFirst({
    where: {
      id: saleId,
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    select: buildDraftSaleSelectShape(),
  });

  if (!draft) throw new Error("SALE_DRAFT_NOT_FOUND");
  return draft;
}

async function recomputeDraftTotalsTx(tx, saleId) {
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

  if (!sale) throw new Error("SALE_NOT_FOUND");

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

  return getSaleDraftTx(tx, (await tx.sale.findUnique({ where: { id: saleId }, select: { tenantId: true } })).tenantId, saleId);
}

async function listSaleDrafts({ tenantId }) {
  const saleFields = prisma.sale.fields || {};

  const drafts = await prisma.sale.findMany({
    where: {
      tenantId,
      ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
      ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
      isCancelled: false,
    },
    orderBy: { createdAt: "desc" },
    select: buildDraftSaleSelectShape(),
  });

  return drafts;
}

async function getSaleDraft({ tenantId, saleId }) {
  const draft = await getSaleDraftTx(prisma, tenantId, saleId);
  return draft;
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

  if (!convo) throw new Error("NOT_FOUND");

  const items = Array.isArray(body?.items) ? body.items : [];
  if (items.length === 0) throw new Error("NO_ITEMS");

  for (const item of items) {
    if (!item?.productId) throw new Error("PRODUCT_ID_REQUIRED");
    const qty = toInt(item.quantity, NaN);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("INVALID_QUANTITY");
  }

  const requestedSaleType = normalizeSaleType(body?.saleType || "CREDIT");
  const parsedDueDate = body?.dueDate ? new Date(body.dueDate) : null;
  if (body?.dueDate && Number.isNaN(parsedDueDate.getTime())) {
    throw new Error("INVALID_DUE_DATE");
  }

  const result = await prisma.$transaction(async (tx) => {
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
      if (!byId.has(pid)) throw new Error("PRODUCT_NOT_FOUND");
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

    const draftCashierId = convo.assignedToId || userId;
    const saleFields = tx.sale.fields || {};

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

    const hydrated = await getSaleDraftTx(tx, tenantId, sale.id);
    return { created: true, draft: hydrated };
  });

  return result;
}

async function updateSaleDraft({ tenantId, saleId, userId, body }) {
  void userId;

  const saleFields = prisma.sale.fields || {};

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

  if (!draft) throw new Error("SALE_DRAFT_NOT_FOUND");

  const result = await prisma.$transaction(async (tx) => {
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
        const parsedDueDate = new Date(body.dueDate);
        if (Number.isNaN(parsedDueDate.getTime())) throw new Error("INVALID_DUE_DATE");
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
      if (items.length === 0) throw new Error("NO_ITEMS");

      for (const item of items) {
        if (!item?.productId) throw new Error("PRODUCT_ID_REQUIRED");
        const qty = toInt(item.quantity, NaN);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error("INVALID_QUANTITY");
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
        if (!byId.has(pid)) throw new Error("PRODUCT_NOT_FOUND");
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

    const recomputed = await recomputeDraftTotalsTx(tx, draft.id);
    return { updated: true, draft: recomputed };
  });

  return result;
}

async function deleteSaleDraft({ tenantId, saleId }) {
  const saleFields = prisma.sale.fields || {};

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
    },
  });

  if (!draft) throw new Error("SALE_DRAFT_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.saleItem.deleteMany({
      where: { saleId: draft.id },
    });

    await tx.sale.delete({
      where: { id: draft.id },
    });
  });

  return { deleted: true, saleId: draft.id };
}

async function finalizeSaleDraft({ tenantId, saleId, userId, body }) {
  const saleFields = prisma.sale.fields || {};

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

  if (!draft) throw new Error("SALE_DRAFT_NOT_FOUND");
  if (!draft.items || draft.items.length === 0) throw new Error("NO_ITEMS");

  const finalSaleType = normalizeSaleType(body?.saleType || draft.saleType || "CREDIT");
  const method = normalizePaymentMethod(body?.paymentMethod || body?.method || "CASH");

  const parsedDueDate =
    body?.dueDate !== undefined
      ? body.dueDate
        ? new Date(body.dueDate)
        : null
      : draft.dueDate || null;

  if (body?.dueDate && Number.isNaN(parsedDueDate.getTime())) {
    throw new Error("INVALID_DUE_DATE");
  }

  const requestedPaid = Math.max(0, toNumber(body?.amountPaid, 0));
  const initialPaid =
    finalSaleType === "CASH" ? Number(draft.total) : Math.min(requestedPaid, Number(draft.total));

  if (finalSaleType === "CREDIT" && initialPaid > Number(draft.total) + 0.000001) {
    throw new Error("PAYMENT_EXCEEDS_TOTAL");
  }

  if (finalSaleType === "CASH") {
    const blockCashSales = await tenantBlocksCashSales(prisma, tenantId);
    if (blockCashSales) {
      const openSessionId = await getOpenCashSessionId(prisma, tenantId);
      if (!openSessionId) {
        const err = new Error("CASH_DRAWER_CLOSED");
        err.code = "CASH_DRAWER_CLOSED";
        throw err;
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
      throw new Error("INSUFFICIENT_STOCK");
    }
  }

  const result = await prisma.$transaction(
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
          throw new Error("INSUFFICIENT_STOCK");
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
          ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {}),
          ...(typeof tx.sale.fields?.draftSource !== "undefined" ? { draftSource: null } : {}),
          ...(typeof tx.sale.fields?.finalizedAt !== "undefined" ? { finalizedAt } : {}),
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
          ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: true } : {}),
          ...(typeof tx.sale.fields?.draftSource !== "undefined" ? { draftSource: true } : {}),
          ...(typeof tx.sale.fields?.finalizedAt !== "undefined" ? { finalizedAt: true } : {}),
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

  return result;
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