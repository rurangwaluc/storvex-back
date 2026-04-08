const axios = require("axios");
const crypto = require("crypto");
const prisma = require("../../config/database");

const { detectIntent } = require("./whatsapp.intent.service");
const {
  searchProducts,
  searchProductsByBudgetIntent,
  findBestProductMatch,
  formatMoneyRwf,
  buildProductsReply,
  buildBudgetProductsReply,
  buildBuyCreatedReply,
  buildBuyMultipleReply,
} = require("./whatsapp.catalog.service");
const {
  extractProductIntent,
  shouldUseAiFallback,
} = require("./whatsapp.ai.service");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

function appError(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function assertEnv() {
  if (!APP_SECRET) throw new Error("Missing WHATSAPP_APP_SECRET");
  if (!VERIFY_TOKEN) throw new Error("Missing WHATSAPP_VERIFY_TOKEN");
}

function graphBase() {
  return `https://graph.facebook.com/${API_VERSION}`;
}

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  return s.replace(/[^\d]/g, "") || null;
}

function normalizeSaleType(value) {
  const v = String(value || "CREDIT").toUpperCase();
  return v === "CASH" ? "CASH" : "CREDIT";
}

function normalizePaymentMethod(value) {
  const v = String(value || "CASH").toUpperCase();
  if (v === "MOMO" || v === "BANK" || v === "OTHER" || v === "CASH") return v;
  return "CASH";
}

function verifySignature(headerValue, rawBodyBuffer) {
  try {
    if (!APP_SECRET) return false;
    if (!headerValue || typeof headerValue !== "string") return false;
    if (!rawBodyBuffer || !Buffer.isBuffer(rawBodyBuffer)) return false;

    const [algo, theirSig] = headerValue.split("=");
    if (algo !== "sha256" || !theirSig) return false;

    const expected = crypto
      .createHmac("sha256", APP_SECRET)
      .update(rawBodyBuffer)
      .digest("hex");

    const a = Buffer.from(theirSig, "hex");
    const b = Buffer.from(expected, "hex");

    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyToken(token) {
  try {
    assertEnv();
    return String(token || "") === String(VERIFY_TOKEN);
  } catch (e) {
    console.error("verifyToken env error:", e.message);
    return false;
  }
}

function extractPhoneNumberId(payload) {
  try {
    return payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || null;
  } catch {
    return null;
  }
}

function extractInboundMessages(payload) {
  const out = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const ch of changes) {
      const value = ch?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const waId = contacts?.[0]?.wa_id || null;

      for (const msg of messages) {
        const type = msg?.type || "unknown";
        const text =
          type === "text"
            ? msg?.text?.body || null
            : type === "button"
            ? msg?.button?.text || null
            : type === "interactive"
            ? msg?.interactive?.button_reply?.title ||
              msg?.interactive?.list_reply?.title ||
              null
            : null;

        out.push({
          waId: waId || msg?.from || null,
          from: msg?.from || null,
          id: msg?.id || null,
          timestamp: msg?.timestamp || null,
          type,
          text,
          raw: msg,
        });
      }
    }
  }

  return out;
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

function saleCodeFromId(saleId) {
  return String(saleId || "").slice(-6).toUpperCase();
}

async function createAuditLogSafe({
  tenantId,
  userId = null,
  entity = "WHATSAPP_MESSAGE",
  entityId = null,
  action,
  metadata = null,
}) {
  try {
    if (!action) return;

    await prisma.auditLog.create({
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
    console.error("WHATSAPP audit log error:", err?.message || err);
  }
}

function sanitizeAxiosError(err) {
  return {
    status: err?.response?.status || null,
    data: err?.response?.data || null,
    message: err?.message || "Request failed",
  };
}

async function sendText({ account, to, text }) {
  if (!account?.phoneNumberId) throw appError("ACCOUNT_MISSING_PHONE_NUMBER_ID");
  if (!account?.accessToken) throw appError("ACCOUNT_MISSING_ACCESS_TOKEN");

  const cleanText = normalizeText(text);
  if (!cleanText) throw appError("TEXT_REQUIRED");

  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "text",
    text: { body: cleanText },
  };

  try {
    const resp = await axios.post(`${graphBase()}/${account.phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    return resp.data;
  } catch (err) {
    console.error("sendText error:", sanitizeAxiosError(err));
    throw appError("WHATSAPP_SEND_TEXT_FAILED", sanitizeAxiosError(err));
  }
}

async function sendTemplate({ account, to, templateName, languageCode, bodyParams }) {
  if (!account?.phoneNumberId) throw appError("ACCOUNT_MISSING_PHONE_NUMBER_ID");
  if (!account?.accessToken) throw appError("ACCOUNT_MISSING_ACCESS_TOKEN");

  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "template",
    template: {
      name: String(templateName),
      language: { code: String(languageCode || "en_US") },
      components: bodyParams?.length
        ? [
            {
              type: "body",
              parameters: bodyParams.map((t) => ({ type: "text", text: String(t) })),
            },
          ]
        : undefined,
    },
  };

  try {
    const resp = await axios.post(`${graphBase()}/${account.phoneNumberId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
    });

    return resp.data;
  } catch (err) {
    console.error("sendTemplate error:", sanitizeAxiosError(err));
    throw appError("WHATSAPP_SEND_TEMPLATE_FAILED", sanitizeAxiosError(err));
  }
}

function buildNotFoundReply({ businessName, query, aiUsed }) {
  const lines = [];
  lines.push(`❌ *${businessName}*`);
  lines.push(`I could not find a matching in-stock product for "${query}".`);
  if (aiUsed) lines.push(`I also tried a clearer interpretation of your message.`);
  lines.push(`Reply with a clearer model, SKU, barcode, brand, or product type.`);
  return lines.join("\n");
}

function buildWelcomeReply({ businessName }) {
  return (
    `👋 Welcome to *${businessName}*.\n` +
    `Send a product name to get price and stock.\n\n` +
    `Examples:\n` +
    `- "A14"\n` +
    `- "price iPhone 13"\n` +
    `- "Type-C charger"\n`
  );
}

function buildPayReply({ businessName, amount, method, reference, updatedSale }) {
  const due = updatedSale?.dueDate
    ? new Date(updatedSale.dueDate).toISOString().slice(0, 10)
    : "N/A";
  const bal = updatedSale?.balanceDue ?? 0;
  const code = saleCodeFromId(updatedSale?.id);

  const lines = [];
  lines.push(`✅ *${businessName}*`);
  lines.push(`Payment received.`);
  lines.push(`Amount: ${formatMoneyRwf(amount)} (${method})`);
  lines.push(`Ref: ${reference}`);
  lines.push(`Order code: *${code}*`);
  lines.push("");
  lines.push(`Order status: *${updatedSale.status}*`);
  lines.push(`Balance remaining: *${formatMoneyRwf(bal)}*`);
  lines.push(`Due date: ${due}`);

  if (bal > 0) {
    lines.push("");
    lines.push(`To finish: PAY ${Math.round(bal)} MOMO <TX_REF> #${code}`);
  } else {
    lines.push("");
    lines.push(`🎉 Fully paid. Thank you!`);
  }

  return lines.join("\n");
}

async function findOutstandingSaleForPay({ tenantId, customerPhone, saleCode }) {
  const phone = String(customerPhone || "").replace(/[^\d]/g, "");
  if (!tenantId || !phone) {
    return { ok: false, code: "INVALID_ARGS" };
  }

  const now = new Date();

  const outstanding = await prisma.sale.findMany({
    where: {
      tenantId,
      saleType: "CREDIT",
      balanceDue: { gt: 0 },
      isDraft: false,
      isCancelled: false,
      customer: { phone },
    },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      dueDate: true,
      status: true,
      createdAt: true,
    },
    take: 25,
  });

  if (!outstanding || outstanding.length === 0) {
    return { ok: false, code: "NO_OUTSTANDING_SALE" };
  }

  if (saleCode) {
    const code = String(saleCode).trim().toUpperCase();

    const matched = outstanding.find((s) => {
      const id = String(s.id || "");
      const last6 = id.slice(-6).toUpperCase();
      return last6 === code || id.toUpperCase().endsWith(code);
    });

    if (!matched) {
      return {
        ok: false,
        code: "SALE_CODE_NOT_FOUND",
        outstandingCount: outstanding.length,
      };
    }

    return { ok: true, sale: matched, outstandingCount: outstanding.length };
  }

  const overdue = outstanding
    .filter((s) => s.dueDate && new Date(s.dueDate).getTime() < now.getTime())
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  if (overdue.length > 0) {
    return { ok: true, sale: overdue[0], outstandingCount: outstanding.length };
  }

  return { ok: true, sale: outstanding[0], outstandingCount: outstanding.length };
}

async function isDuplicatePayReference({ tenantId, reference }) {
  const note = `WA_PAY:${reference}`;

  const dup = await prisma.salePayment.findFirst({
    where: { tenantId, note },
    select: { id: true, saleId: true },
  });

  return dup || null;
}

async function applyPaymentToSale({
  tenantId,
  saleId,
  amount,
  method,
  reference,
  receivedByUserId,
}) {
  const note = `WA_PAY:${reference}`;
  const normalizedMethod = normalizePaymentMethod(method);

  try {
    return await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: {
          id: saleId,
          tenantId,
          isDraft: false,
          isCancelled: false,
        },
        select: {
          id: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          dueDate: true,
          saleType: true,
        },
      });

      if (!sale) return { ok: false, code: "SALE_NOT_FOUND" };
      if (sale.saleType !== "CREDIT") return { ok: false, code: "NOT_CREDIT_SALE" };

      const payAmount = Number(amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        return { ok: false, code: "INVALID_AMOUNT" };
      }

      if (payAmount > Number(sale.balanceDue) + 0.000001) {
        return { ok: false, code: "OVERPAY", sale };
      }

      const payment = await tx.salePayment.create({
        data: {
          saleId: sale.id,
          tenantId,
          receivedById: receivedByUserId || null,
          amount: payAmount,
          method: normalizedMethod,
          note,
        },
        select: { id: true, amount: true, method: true, createdAt: true, note: true },
      });

      const newPaid = Number(sale.amountPaid) + payAmount;
      const total = Number(sale.total) || 0;
      const newBalance = Math.max(0, total - newPaid);

      let newStatus = "UNPAID";
      if (newBalance <= 0) newStatus = "PAID";
      else if (newPaid > 0) newStatus = "PARTIAL";

      if (sale.dueDate && newBalance > 0 && new Date(sale.dueDate) < new Date()) {
        newStatus = "OVERDUE";
      }

      const updatedSale = await tx.sale.update({
        where: { id: sale.id },
        data: {
          amountPaid: newPaid,
          balanceDue: newBalance,
          status: newStatus,
        },
        select: {
          id: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          status: true,
          dueDate: true,
        },
      });

      await createAuditLogSafe({
        tenantId,
        userId: receivedByUserId || null,
        entity: "PAYMENT",
        entityId: payment.id,
        action: "WHATSAPP_PAYMENT_RECORDED",
        metadata: {
          saleId: sale.id,
          amount: payAmount,
          method: normalizedMethod,
          reference,
          source: "WHATSAPP",
        },
      });

      return { ok: true, payment, updatedSale };
    });
  } catch (err) {
    if (err && err.code === "P2002") {
      return { ok: false, code: "DUP_REFERENCE" };
    }
    throw err;
  }
}

async function resolveDraftCashierId({ tenantId, assignedToId }) {
  if (assignedToId) {
    const assigned = await prisma.user.findFirst({
      where: {
        id: assignedToId,
        tenantId,
        isActive: true,
      },
      select: { id: true },
    });

    if (assigned) return assigned.id;
  }

  const fallback = await prisma.user.findFirst({
    where: {
      tenantId,
      isActive: true,
      role: {
        in: ["OWNER", "MANAGER", "CASHIER", "SELLER"],
      },
    },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true },
  });

  if (!fallback) throw appError("NO_ACTIVE_STAFF_FOR_WHATSAPP_DRAFT");

  return fallback.id;
}

async function createOrUpdateWhatsAppDraftFromBuy({
  tenantId,
  conversationId,
  customerId,
  cashierId,
  product,
  quantity,
}) {
  const existingDraft = await prisma.sale.findFirst({
    where: {
      tenantId,
      customerId,
      isDraft: true,
      draftSource: "WHATSAPP",
      isCancelled: false,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      saleType: true,
      dueDate: true,
    },
  });

  return prisma.$transaction(async (tx) => {
    if (existingDraft) {
      const existingItem = await tx.saleItem.findFirst({
        where: {
          saleId: existingDraft.id,
          productId: product.id,
        },
        select: {
          id: true,
          quantity: true,
        },
      });

      if (existingItem) {
        await tx.saleItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: existingItem.quantity + quantity,
            price: Number(product.sellPrice || 0),
          },
        });
      } else {
        await tx.saleItem.create({
          data: {
            saleId: existingDraft.id,
            productId: product.id,
            quantity,
            price: Number(product.sellPrice || 0),
          },
        });
      }

      const items = await tx.saleItem.findMany({
        where: { saleId: existingDraft.id },
        select: { quantity: true, price: true },
      });

      const total = items.reduce(
        (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
        0
      );

      const { status, balanceDue } = computeSaleStatus({
        saleType: existingDraft.saleType || "CREDIT",
        total,
        amountPaid: 0,
        dueDate: existingDraft.dueDate || null,
      });

      await tx.sale.update({
        where: { id: existingDraft.id },
        data: {
          total,
          amountPaid: 0,
          balanceDue,
          status,
        },
      });

      await createAuditLogSafe({
        tenantId,
        userId: cashierId || null,
        entity: "SALE",
        entityId: existingDraft.id,
        action: "WHATSAPP_DRAFT_UPDATED_FROM_BUY",
        metadata: {
          source: "WHATSAPP",
          conversationId,
          customerId,
          productId: product.id,
          quantityAdded: quantity,
        },
      });

      return { draftId: existingDraft.id, isNew: false };
    }

    const total = Number(product.sellPrice || 0) * quantity;

    const { status, balanceDue } = computeSaleStatus({
      saleType: "CREDIT",
      total,
      amountPaid: 0,
      dueDate: null,
    });

    const sale = await tx.sale.create({
      data: {
        tenantId,
        cashierId,
        customerId: customerId || null,
        total,
        saleType: normalizeSaleType("CREDIT"),
        amountPaid: 0,
        balanceDue,
        status,
        isDraft: true,
        draftSource: "WHATSAPP",
        ...(conversationId ? { conversationId } : {}),
      },
      select: { id: true },
    });

    await tx.saleItem.create({
      data: {
        saleId: sale.id,
        productId: product.id,
        quantity,
        price: Number(product.sellPrice || 0),
      },
    });

    if (conversationId) {
      await tx.whatsAppConversation.update({
        where: { id: conversationId },
        data: { customerId: customerId || null },
      });
    }

    await createAuditLogSafe({
      tenantId,
      userId: cashierId || null,
      entity: "SALE",
      entityId: sale.id,
      action: "WHATSAPP_DRAFT_CREATED_FROM_BUY",
      metadata: {
        source: "WHATSAPP",
        conversationId,
        customerId,
        productId: product.id,
        quantity,
      },
    });

    return { draftId: sale.id, isNew: true };
  });
}

async function tryAiCatalogFallback({ tenantId, text, directQuery }) {
  const directProducts = await searchProducts({
    tenantId,
    q: directQuery,
    take: 3,
  });

  if (Array.isArray(directProducts) && directProducts.length > 0) {
    return {
      mode: "DIRECT",
      usedAi: false,
      queryUsed: directQuery,
      products: directProducts,
      aiMeta: null,
      budgetMeta: null,
    };
  }

  const useAi = shouldUseAiFallback({
    text,
    deterministicQuery: directQuery,
    searchResultsCount: directProducts.length,
  });

  let aiMeta = null;

  if (useAi) {
    try {
      const ai = await extractProductIntent({ messageText: text });
      aiMeta = ai || null;
      const aiQuery = normalizeText(ai?.normalizedQuery);

      if (
        aiQuery &&
        aiQuery.toLowerCase() !== String(directQuery || "").trim().toLowerCase()
      ) {
        const aiProducts = await searchProducts({
          tenantId,
          q: aiQuery,
          take: 3,
        });

        if (Array.isArray(aiProducts) && aiProducts.length > 0) {
          return {
            mode: "AI",
            usedAi: true,
            queryUsed: aiQuery,
            products: aiProducts,
            aiMeta,
            budgetMeta: null,
          };
        }
      }
    } catch (err) {
      console.error("WHATSAPP: AI fallback failed:", err?.message || err);
    }
  }

  const budgetFallback = await searchProductsByBudgetIntent({
    tenantId,
    text,
    take: 3,
  });

  if (Array.isArray(budgetFallback.products) && budgetFallback.products.length > 0) {
    return {
      mode: "BUDGET",
      usedAi: false,
      queryUsed: directQuery,
      products: budgetFallback.products,
      aiMeta,
      budgetMeta: budgetFallback.meta,
    };
  }

  return {
    mode: "DIRECT",
    usedAi: false,
    queryUsed: directQuery,
    products: directProducts,
    aiMeta,
    budgetMeta: null,
  };
}

async function safeSendAndLog({
  account,
  tenantId,
  convoId,
  to,
  text,
  auditAction = null,
}) {
  try {
    const resp = await sendText({ account, to, text });
    const metaMsgId = resp?.messages?.[0]?.id || null;

    const saved = await prisma.whatsAppMessage.create({
      data: {
        conversationId: convoId,
        tenantId,
        accountId: account.id,
        direction: "OUTBOUND",
        type: "TEXT",
        textContent: String(text),
        messageId: metaMsgId,
      },
      select: { id: true },
    });

    if (auditAction) {
      await createAuditLogSafe({
        tenantId,
        entity: "WHATSAPP_MESSAGE",
        entityId: saved.id,
        action: auditAction,
        metadata: {
          conversationId: convoId,
          phone: to,
          providerMessageId: metaMsgId,
        },
      });
    }

    return saved;
  } catch (err) {
    console.error("WHATSAPP: failed to send outbound:", err?.response?.data || err?.message || err);
    return null;
  }
}

async function bumpConvo(convoId) {
  try {
    await prisma.whatsAppConversation.update({
      where: { id: convoId },
      data: { updatedAt: new Date() },
    });
  } catch {}
}

async function resolveBusinessName(tenantId, account) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  return (
    normalizeText(account?.businessName) ||
    normalizeText(tenant?.name) ||
    "our store"
  );
}

async function resolveConversationAndCustomer({ tenantId, accountId, from }) {
  const customer = await prisma.customer.upsert({
    where: { tenantId_phone: { tenantId, phone: from } },
    update: { whatsappOptIn: true },
    create: {
      tenantId,
      phone: from,
      name: from,
      whatsappOptIn: true,
    },
    select: { id: true },
  });

  let convo = await prisma.whatsAppConversation.findFirst({
    where: {
      tenantId,
      accountId,
      phone: from,
      status: "OPEN",
    },
    select: {
      id: true,
      assignedToId: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!convo) {
    convo = await prisma.whatsAppConversation.create({
      data: {
        tenantId,
        accountId,
        customerId: customer.id,
        phone: from,
        status: "OPEN",
      },
      select: {
        id: true,
        assignedToId: true,
      },
    });

    await createAuditLogSafe({
      tenantId,
      entity: "WHATSAPP_CONVERSATION",
      entityId: convo.id,
      action: "WHATSAPP_CONVERSATION_CREATED",
      metadata: {
        phone: from,
        accountId,
        source: "WEBHOOK",
      },
    });
  }

  return { customer, convo };
}

async function saveInboundMessage({ tenantId, accountId, convoId, message }) {
  try {
    const type = String(message?.type || "").toUpperCase() || "UNKNOWN";

    const inboundSaved = await prisma.whatsAppMessage.create({
      data: {
        conversationId: convoId,
        tenantId,
        accountId,
        direction: "INBOUND",
        type,
        textContent: message?.text || null,
        messageId: message?.id ? String(message.id) : null,
      },
      select: { id: true },
    });

    await createAuditLogSafe({
      tenantId,
      entity: "WHATSAPP_MESSAGE",
      entityId: inboundSaved.id,
      action: "WHATSAPP_INBOUND_RECEIVED",
      metadata: {
        conversationId: convoId,
        phone: normalizePhone(message?.waId || message?.from),
        messageType: type,
        source: "WEBHOOK",
      },
    });

    return inboundSaved;
  } catch (err) {
    if (err && err.code === "P2002") {
      console.log("WHATSAPP: duplicate inbound messageId, skipping:", message?.id);
      return null;
    }

    console.error("WHATSAPP: failed to save inbound message:", err);
    throw err;
  }
}

async function handlePayIntent({ tenantId, account, convo, from, businessName, payload }) {
  const { amount, method, reference, saleCode } = payload;

  const dup = await isDuplicatePayReference({ tenantId, reference });

  if (dup) {
    const reply = `⚠️ *${businessName}*\nThat payment reference was already recorded.\nRef: ${reference}`;
    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });
    await bumpConvo(convo.id);
    return;
  }

  const target = await findOutstandingSaleForPay({
    tenantId,
    customerPhone: from,
    saleCode,
  });

  if (!target.ok) {
    let reply = `❌ *${businessName}*\nPayment failed. Please try again.`;

    if (target.code === "NO_OUTSTANDING_SALE") {
      reply =
        `❌ *${businessName}*\n` +
        `I cannot find an unpaid order for this number.\n` +
        `Ask for a product first, then staff can create a draft or sale.`;
    } else if (target.code === "SALE_CODE_NOT_FOUND") {
      reply =
        `❌ *${businessName}*\n` +
        `I cannot find that order code.\n` +
        `Please send PAY again with the correct #CODE.`;
    }

    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });
    await bumpConvo(convo.id);
    return;
  }

  try {
    const applied = await applyPaymentToSale({
      tenantId,
      saleId: target.sale.id,
      amount,
      method,
      reference,
      receivedByUserId: null,
    });

    if (!applied.ok) {
      const reply = `❌ *${businessName}*\nPayment failed. Please try again.`;
      await safeSendAndLog({
        account,
        tenantId,
        convoId: convo.id,
        to: from,
        text: reply,
        auditAction: "WHATSAPP_AUTO_REPLY_SENT",
      });
      await bumpConvo(convo.id);
      return;
    }

    const reply = buildPayReply({
      businessName,
      amount,
      method,
      reference,
      updatedSale: { ...applied.updatedSale, id: target.sale.id },
    });

    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });

    if (Number(applied.updatedSale.balanceDue) <= 0) {
      await prisma.whatsAppConversation.update({
        where: { id: convo.id },
        data: { status: "CLOSED" },
      });

      await createAuditLogSafe({
        tenantId,
        entity: "WHATSAPP_CONVERSATION",
        entityId: convo.id,
        action: "WHATSAPP_CONVERSATION_AUTO_CLOSED",
        metadata: {
          reason: "SALE_FULLY_PAID",
          saleId: target.sale.id,
        },
      });
    }

    await bumpConvo(convo.id);
  } catch (err) {
    console.error("WHATSAPP: applyPaymentToSale error:", err);

    const reply = `❌ *${businessName}*\nPayment failed. Please try again.`;
    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });
    await bumpConvo(convo.id);
  }
}

async function handleBuyIntent({
  tenantId,
  account,
  convo,
  customer,
  from,
  businessName,
  payload,
}) {
  const { quantity, query } = payload;

  try {
    const match = await findBestProductMatch({ tenantId, query });

    if (match.kind === "NONE") {
      const reply =
        `❌ *${businessName}*\n` +
        `I could not find "${query}" in stock.\n` +
        `Reply with a clearer model, SKU, or barcode.`;

      await safeSendAndLog({
        account,
        tenantId,
        convoId: convo.id,
        to: from,
        text: reply,
        auditAction: "WHATSAPP_AUTO_REPLY_SENT",
      });
      await bumpConvo(convo.id);
      return;
    }

    if (match.kind === "MULTIPLE") {
      const reply = buildBuyMultipleReply({
        businessName,
        query,
        candidates: match.candidates,
      });

      await safeSendAndLog({
        account,
        tenantId,
        convoId: convo.id,
        to: from,
        text: reply,
        auditAction: "WHATSAPP_AUTO_REPLY_SENT",
      });
      await bumpConvo(convo.id);
      return;
    }

    const product = match.product;

    if (Number(product.stockQty || 0) < quantity) {
      const reply =
        `❌ *${businessName}*\n` +
        `Requested quantity is higher than available stock.\n` +
        `Available: *${product.stockQty}*`;

      await safeSendAndLog({
        account,
        tenantId,
        convoId: convo.id,
        to: from,
        text: reply,
        auditAction: "WHATSAPP_AUTO_REPLY_SENT",
      });
      await bumpConvo(convo.id);
      return;
    }

    const cashierId = await resolveDraftCashierId({
      tenantId,
      assignedToId: convo.assignedToId || null,
    });

    const created = await createOrUpdateWhatsAppDraftFromBuy({
      tenantId,
      conversationId: convo.id,
      customerId: customer.id,
      cashierId,
      product,
      quantity,
    });

    const reply = buildBuyCreatedReply({
      businessName,
      product,
      quantity,
      draftId: created.draftId,
    });

    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });

    await bumpConvo(convo.id);
  } catch (err) {
    console.error("WHATSAPP: BUY flow error:", err);

    const reply =
      err?.message === "NO_ACTIVE_STAFF_FOR_WHATSAPP_DRAFT" ||
      err?.code === "NO_ACTIVE_STAFF_FOR_WHATSAPP_DRAFT"
        ? `❌ *${businessName}*\nI found the product, but I cannot create the draft because no active staff account is available for this store.`
        : `❌ *${businessName}*\nI could not create the draft right now. Please try again.`;

    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_AUTO_REPLY_SENT",
    });
    await bumpConvo(convo.id);
  }
}

async function handleProductQueryIntent({
  tenantId,
  account,
  convo,
  from,
  businessName,
  text,
  directQuery,
}) {
  if (!directQuery) {
    const reply = buildWelcomeReply({ businessName });
    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_WELCOME_SENT",
    });
    await bumpConvo(convo.id);
    return;
  }

  const result = await tryAiCatalogFallback({
    tenantId,
    text,
    directQuery,
  });

  if (Array.isArray(result.products) && result.products.length > 0) {
    let reply;

    if (result.mode === "BUDGET") {
      reply = buildBudgetProductsReply({
        businessName,
        originalText: text,
        products: result.products,
        meta: result.budgetMeta,
      });
    } else {
      reply = buildProductsReply({
        businessName,
        q: result.queryUsed,
        products: result.products,
      });
    }

    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: reply,
      auditAction: "WHATSAPP_PRODUCT_REPLY_SENT",
    });
    await bumpConvo(convo.id);
    return;
  }

  const reply = buildNotFoundReply({
    businessName,
    query: directQuery,
    aiUsed: result.usedAi,
  });

  await safeSendAndLog({
    account,
    tenantId,
    convoId: convo.id,
    to: from,
    text: reply,
    auditAction: "WHATSAPP_AUTO_REPLY_SENT",
  });
  await bumpConvo(convo.id);
}

async function handleGreetingOrUnknownIntent({
  tenantId,
  account,
  convo,
  from,
  businessName,
}) {
  const outboundCount = await prisma.whatsAppMessage.count({
    where: { conversationId: convo.id, direction: "OUTBOUND" },
  });

  if (outboundCount === 0) {
    const welcome = buildWelcomeReply({ businessName });
    await safeSendAndLog({
      account,
      tenantId,
      convoId: convo.id,
      to: from,
      text: welcome,
      auditAction: "WHATSAPP_WELCOME_SENT",
    });
  }

  await bumpConvo(convo.id);
}

async function processWebhookPayload({ headers, rawBody, body }) {
  assertEnv();

  const sigHeader =
    headers?.["x-hub-signature-256"] ||
    headers?.["X-Hub-Signature-256"] ||
    null;

  const ok = verifySignature(String(sigHeader || ""), rawBody);

  if (!ok) {
    console.error("WHATSAPP: invalid signature.");
    return;
  }

  const phoneNumberId = extractPhoneNumberId(body);
  if (!phoneNumberId) {
    console.error("WHATSAPP: missing metadata.phone_number_id.");
    return;
  }

  const account = await prisma.whatsAppAccount.findUnique({
    where: { phoneNumberId: String(phoneNumberId) },
  });

  if (!account || !account.isActive) {
    console.error("WHATSAPP: no active account found for phoneNumberId:", phoneNumberId);
    return;
  }

  const inbound = extractInboundMessages(body);

  console.log(
    `WHATSAPP: webhook accepted. tenant=${account.tenantId} inbound_count=${inbound.length}`
  );

  await handleInboundWebhook({ account, payload: body, inbound });
}

async function handleInboundWebhook({ account, payload, inbound }) {
  void payload;

  const tenantId = account.tenantId;
  const businessName = await resolveBusinessName(tenantId, account);

  for (const message of inbound) {
    const text = normalizeText(message?.text) || "";
    const from = normalizePhone(message?.waId || message?.from);
    if (!from) continue;

    try {
      const { customer, convo } = await resolveConversationAndCustomer({
        tenantId,
        accountId: account.id,
        from,
      });

      const saved = await saveInboundMessage({
        tenantId,
        accountId: account.id,
        convoId: convo.id,
        message,
      });

      if (message?.id && !saved) continue;

      const intent = detectIntent(text);

      if (intent.type === "PAY") {
        await handlePayIntent({
          tenantId,
          account,
          convo,
          from,
          businessName,
          payload: intent.payload,
        });
        continue;
      }

      if (intent.type === "BUY") {
        await handleBuyIntent({
          tenantId,
          account,
          convo,
          customer,
          from,
          businessName,
          payload: intent.payload,
        });
        continue;
      }

      if (intent.type === "PRODUCT_QUERY") {
        const directQuery = normalizeText(intent.payload?.query || text);

        await handleProductQueryIntent({
          tenantId,
          account,
          convo,
          from,
          businessName,
          text,
          directQuery,
        });
        continue;
      }

      if (
        intent.type === "GREETING" ||
        intent.type === "UNKNOWN" ||
        intent.type === "HUMAN_HELP" ||
        intent.type === "EMPTY"
      ) {
        await handleGreetingOrUnknownIntent({
          tenantId,
          account,
          convo,
          from,
          businessName,
        });
      }
    } catch (err) {
      console.error("WHATSAPP inbound processing error:", err?.message || err);
    }
  }
}

module.exports = {
  verifySignature,
  verifyToken,
  processWebhookPayload,
  sendTemplate,
  sendText,
  handleInboundWebhook,
};