// src/modules/whatsapp/whatsapp.service.js

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

function normalizePhone(x) {
  const s = String(x || "").trim();
  if (!s) return null;
  return s.replace(/[^\d]/g, "") || null;
}

function normalizeSaleType(value) {
  const v = String(value || "CREDIT").toUpperCase();
  return v === "CASH" ? "CASH" : "CREDIT";
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
        out.push({
          waId: waId || msg?.from || null,
          from: msg?.from || null,
          id: msg?.id || null,
          timestamp: msg?.timestamp || null,
          type: msg?.type || null,
          text: msg?.text?.body || null,
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

async function sendText({ account, to, text }) {
  if (!account?.phoneNumberId) throw new Error("Account missing phoneNumberId");
  if (!account?.accessToken) throw new Error("Account missing accessToken");

  const payload = {
    messaging_product: "whatsapp",
    to: String(to),
    type: "text",
    text: { body: String(text) },
  };

  const resp = await axios.post(`${graphBase()}/${account.phoneNumberId}/messages`, payload, {
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json",
    },
  });

  return resp.data;
}

async function sendTemplate({ account, to, templateName, languageCode, bodyParams }) {
  if (!account?.phoneNumberId) throw new Error("Account missing phoneNumberId");
  if (!account?.accessToken) throw new Error("Account missing accessToken");

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

  const resp = await axios.post(`${graphBase()}/${account.phoneNumberId}/messages`, payload, {
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json",
    },
  });

  return resp.data;
}

function saleCodeFromId(saleId) {
  return String(saleId || "").slice(-6).toUpperCase();
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

  const normalizedMethod = (() => {
    const v = String(method || "CASH").toUpperCase();
    return v === "MOMO" || v === "BANK" || v === "OTHER" ? v : "CASH";
  })();

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

      return { ok: true, payment, updatedSale };
    });
  } catch (err) {
    if (err && err.code === "P2002") {
      return { ok: false, code: "DUP_REFERENCE" };
    }
    throw err;
  }
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

function buildNotFoundReply({ businessName, query, aiUsed }) {
  const lines = [];
  lines.push(`❌ *${businessName}*`);
  lines.push(`I could not find a matching in-stock product for "${query}".`);

  if (aiUsed) {
    lines.push(`I also tried a normalized interpretation of your message.`);
  }

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

  if (!fallback) {
    throw new Error("NO_ACTIVE_STAFF_FOR_WHATSAPP_DRAFT");
  }

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

      return { draftId: existingDraft.id };
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

    return { draftId: sale.id };
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

  const shouldFallback = shouldUseAiFallback({
    text,
    deterministicQuery: directQuery,
    searchResultsCount: directProducts.length,
  });

  let aiMeta = null;

  if (shouldFallback) {
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

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });

  const businessName =
    (account.businessName && String(account.businessName).trim()) ||
    (tenant?.name && String(tenant.name).trim()) ||
    "our store";

  for (const m of inbound) {
    const text = m.text ? String(m.text).trim() : "";
    const from = normalizePhone(m.waId || m.from);
    if (!from) continue;

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
        accountId: account.id,
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
          accountId: account.id,
          customerId: customer.id,
          phone: from,
          status: "OPEN",
        },
        select: {
          id: true,
          assignedToId: true,
        },
      });
    }

    try {
      await prisma.whatsAppMessage.create({
        data: {
          conversationId: convo.id,
          tenantId,
          accountId: account.id,
          direction: "INBOUND",
          type: "TEXT",
          textContent: text || null,
          messageId: m.id ? String(m.id) : null,
        },
        select: { id: true },
      });
    } catch (err) {
      if (err && err.code === "P2002") {
        console.log("WHATSAPP: duplicate inbound messageId, skipping:", m.id);
        continue;
      }

      console.error("WHATSAPP: failed to save inbound message:", err);
      continue;
    }

    const intent = detectIntent(text);

    if (intent.type === "PAY") {
      const { amount, method, reference, saleCode } = intent.payload;

      const dup = await isDuplicatePayReference({ tenantId, reference });

      if (dup) {
        const reply = `⚠️ *${businessName}*\nThat payment reference was already recorded.\nRef: ${reference}`;
        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
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

        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
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
          await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
          await bumpConvo(convo.id);
          continue;
        }

        const reply = buildPayReply({
          businessName,
          amount,
          method,
          reference,
          updatedSale: { ...applied.updatedSale, id: target.sale.id },
        });

        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });

        if (Number(applied.updatedSale.balanceDue) <= 0) {
          await prisma.whatsAppConversation.update({
            where: { id: convo.id },
            data: { status: "CLOSED" },
          });
        }

        await bumpConvo(convo.id);
        continue;
      } catch (e) {
        console.error("WHATSAPP: applyPaymentToSale error:", e);
        const reply = `❌ *${businessName}*\nPayment failed. Please try again.`;
        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
      }
    }

    if (intent.type === "BUY") {
      const { quantity, query } = intent.payload;

      try {
        const match = await findBestProductMatch({ tenantId, query });

        if (match.kind === "NONE") {
          const reply =
            `❌ *${businessName}*\n` +
            `I could not find "${query}" in stock.\n` +
            `Reply with a clearer model, SKU, or barcode.`;

          await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
          await bumpConvo(convo.id);
          continue;
        }

        if (match.kind === "MULTIPLE") {
          const reply = buildBuyMultipleReply({
            businessName,
            query,
            candidates: match.candidates,
          });

          await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
          await bumpConvo(convo.id);
          continue;
        }

        const product = match.product;

        if (Number(product.stockQty || 0) < quantity) {
          const reply =
            `❌ *${businessName}*\n` +
            `Requested quantity is higher than available stock.\n` +
            `Available: *${product.stockQty}*`;

          await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
          await bumpConvo(convo.id);
          continue;
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

        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
      } catch (err) {
        console.error("WHATSAPP: BUY flow error:", err);

        const reply =
          err?.message === "NO_ACTIVE_STAFF_FOR_WHATSAPP_DRAFT"
            ? `❌ *${businessName}*\nI found the product, but I cannot create the draft because no active staff account is available for this store.`
            : `❌ *${businessName}*\nI could not create the draft right now. Please try again.`;

        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
      }
    }

    if (intent.type === "PRODUCT_QUERY") {
      const directQuery = normalizeText(intent.payload?.query || text);

      if (!directQuery) {
        const reply = buildWelcomeReply({ businessName });
        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
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

        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
        await bumpConvo(convo.id);
        continue;
      }

      const reply = buildNotFoundReply({
        businessName,
        query: directQuery,
        aiUsed: result.usedAi,
      });

      await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: reply });
      await bumpConvo(convo.id);
      continue;
    }

    if (
      intent.type === "GREETING" ||
      intent.type === "UNKNOWN" ||
      intent.type === "HUMAN_HELP"
    ) {
      const outboundCount = await prisma.whatsAppMessage.count({
        where: { conversationId: convo.id, direction: "OUTBOUND" },
      });

      if (outboundCount === 0) {
        const welcome = buildWelcomeReply({ businessName });
        await safeSendAndLog({ account, tenantId, convoId: convo.id, to: from, text: welcome });
      }

      await bumpConvo(convo.id);
      continue;
    }
  }
}

async function safeSendAndLog({ account, tenantId, convoId, to, text }) {
  try {
    const resp = await sendText({ account, to, text });
    const metaMsgId = resp?.messages?.[0]?.id || null;

    await prisma.whatsAppMessage.create({
      data: {
        conversationId: convoId,
        tenantId,
        accountId: account.id,
        direction: "OUTBOUND",
        type: "TEXT",
        textContent: String(text),
        messageId: metaMsgId,
      },
    });
  } catch (e) {
    console.error("WHATSAPP: failed to send outbound:", e?.response?.data || e.message);
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

module.exports = {
  verifySignature,
  verifyToken,
  processWebhookPayload,
  sendTemplate,
  sendText,
  handleInboundWebhook,
};