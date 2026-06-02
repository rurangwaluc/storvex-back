const prisma = require("../../config/database");
const whatsappService = require("./whatsapp.service");

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

function isConnectionClosedError(error) {
  return (
    error?.code === "P1017" ||
    String(error?.message || "").toLowerCase().includes("server has closed the connection")
  );
}

async function withPrismaRetry(operation, attempts = 2) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isConnectionClosedError(error) || attempt >= attempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError;
}

function friendlySendFailure(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const providerCode = Number(error?.data?.error?.code || error?.response?.data?.error?.code || 0);
  const providerMessage = String(
    error?.data?.error?.message ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "",
  ).toLowerCase();

  if (providerCode === 132001 || providerMessage.includes("template name does not exist")) {
    return "The WhatsApp message format is not approved for this sending language.";
  }

  if (providerCode === 131030 || providerMessage.includes("not in allowed list")) {
    return "This customer phone number is not allowed for the current WhatsApp sending setup.";
  }

  if (status === 400) {
    return "WhatsApp rejected this customer message. Check the customer phone number and approved message format.";
  }

  if (status === 401 || status === 403) {
    return "The WhatsApp sending account needs attention before messages can be sent.";
  }

  if (status === 404) {
    return "The WhatsApp message format could not be found for this sending setup.";
  }

  if (status === 429) {
    return "WhatsApp is limiting customer messages right now. Try again later.";
  }

  if (status >= 500) {
    return "WhatsApp could not process this customer message right now. Try again later.";
  }

  return "This customer message could not be sent.";
}

function normalizeLanguageCode(value) {
  const s = String(value || "").trim();
  return s || "en_US";
}

function normalizeStatus(value, fallback = "DRAFT") {
  const v = String(value || fallback).trim().toUpperCase();
  if (v === "DRAFT" || v === "QUEUED" || v === "SENT" || v === "FAILED") return v;
  return fallback;
}

function normalizeTargetMode(value) {
  const v = String(value || "ALL_OPTED_IN").trim().toUpperCase();

  if (v === "ALL_OPTED_IN") return "ALL_OPTED_IN";
  if (v === "BRANCH_CUSTOMERS") return "BRANCH_CUSTOMERS";
  if (v === "CREDIT_CUSTOMERS") return "CREDIT_CUSTOMERS";
  if (v === "OVERDUE_CREDIT_CUSTOMERS") return "OVERDUE_CREDIT_CUSTOMERS";
  if (v === "PRODUCT_BUYERS") return "PRODUCT_BUYERS";
  if (v === "MANUAL_CUSTOMERS") return "MANUAL_CUSTOMERS";

  return "ALL_OPTED_IN";
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizePhone(value) {
  const s = digitsOnly(value);
  return s || null;
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clampLimit(value, fallback = 50, max = 200) {
  const n = toInt(value, fallback);
  return Math.min(max, Math.max(1, n));
}

function getModelFields(delegate) {
  try {
    return delegate?.fields || {};
  } catch {
    return {};
  }
}

function buildCustomerWhereBase(tenantId) {
  const customerFields = getModelFields(prisma.customer);

  return {
    tenantId,
    ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
    ...(typeof customerFields.whatsappOptIn !== "undefined" ? { whatsappOptIn: true } : {}),
  };
}

function customerSelectShape() {
  const customerFields = getModelFields(prisma.customer);

  return {
    id: true,
    name: true,
    phone: true,
    ...(typeof customerFields.email !== "undefined" ? { email: true } : {}),
    ...(typeof customerFields.whatsappOptIn !== "undefined" ? { whatsappOptIn: true } : {}),
    ...(typeof customerFields.isActive !== "undefined" ? { isActive: true } : {}),
  };
}

function broadcastIncludeShape() {
  return {
    account: {
      select: {
        id: true,
        phoneNumber: true,
        businessName: true,
        isActive: true,
      },
    },
    promotion: {
      select: {
        id: true,
        title: true,
        message: true,
        productId: true,
        sentAt: true,
        createdAt: true,
      },
    },
    createdBy: {
      select: {
        id: true,
        name: true,
        role: true,
      },
    },
    messages: {
      select: {
        id: true,
        messageId: true,
        conversationId: true,
      },
    },
  };
}

function buildPublicBroadcast(broadcast) {
  if (!broadcast) return null;

  const messages = Array.isArray(broadcast.messages) ? broadcast.messages : [];

  return {
    id: broadcast.id,
    tenantId: broadcast.tenantId,
    accountId: broadcast.accountId,
    promotionId: broadcast.promotionId || null,
    templateName: broadcast.templateName,
    languageCode: broadcast.languageCode,
    status: broadcast.status,
    createdById: broadcast.createdById,
    queuedAt: broadcast.queuedAt || null,
    sentAt: broadcast.sentAt || null,
    createdAt: broadcast.createdAt,

    strategy: {
      mode: "ONE_STORE_NUMBER",
      customerFacingLabel: "One WhatsApp number for the store",
      customerSelectionNote:
        "Broadcasts are sent from the store WhatsApp number. The selected audience controls which customers receive the message.",
    },

    account: broadcast.account
      ? {
          id: broadcast.account.id,
          phoneNumber: broadcast.account.phoneNumber,
          businessName: broadcast.account.businessName,
          isActive: Boolean(broadcast.account.isActive),
        }
      : null,

    promotion: broadcast.promotion
      ? {
          id: broadcast.promotion.id,
          title: broadcast.promotion.title,
          message: broadcast.promotion.message,
          productId: broadcast.promotion.productId || null,
          sentAt: broadcast.promotion.sentAt || null,
          createdAt: broadcast.promotion.createdAt || null,
        }
      : null,

    createdBy: broadcast.createdBy
      ? {
          id: broadcast.createdBy.id,
          name: broadcast.createdBy.name,
          role: broadcast.createdBy.role,
        }
      : null,

    recipientCount: messages.length,
    deliveredCount: messages.filter((m) => String(m.messageId || "").trim()).length,
  };
}

async function ensureTenantExists(tenantId) {
  if (!tenantId) {
    throw appError("TENANT_REQUIRED");
  }

  const tenant = await withPrismaRetry(() =>
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    }),
  );

  if (!tenant) {
    throw appError("TENANT_NOT_FOUND");
  }

  return tenant;
}

async function assertBranchBelongsToTenant(tenantId, branchId) {
  if (!branchId) throw appError("BRANCH_REQUIRED");

  const branch = await withPrismaRetry(() =>
    prisma.branch.findFirst({
      where: {
        id: String(branchId),
        tenantId,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        code: true,
        isMain: true,
        status: true,
      },
    }),
  );

  if (!branch) throw appError("BRANCH_NOT_FOUND");

  return branch;
}

async function getActiveAccountOrThrow(tenantId, accountId) {
  const where = {
    tenantId,
    isActive: true,
    ...(accountId ? { id: String(accountId) } : {}),
  };

  const account = await withPrismaRetry(() =>
    prisma.whatsAppAccount.findFirst({
      where,
      select: {
        id: true,
        tenantId: true,
        phoneNumber: true,
        phoneNumberId: true,
        businessName: true,
        accessToken: true,
        isActive: true,
      },
      orderBy: accountId ? undefined : [{ createdAt: "desc" }],
    }),
  );

  if (!account) {
    throw appError("WHATSAPP_ACCOUNT_NOT_FOUND");
  }

  if (!account.phoneNumberId) {
    throw appError("WHATSAPP_ACCOUNT_PHONE_NUMBER_ID_MISSING");
  }

  if (!account.accessToken) {
    throw appError("WHATSAPP_ACCOUNT_ACCESS_TOKEN_MISSING");
  }

  return account;
}

async function getPromotionOrThrow(tenantId, promotionId) {
  const promotion = await withPrismaRetry(() =>
    prisma.promotion.findFirst({
      where: {
        id: String(promotionId),
        tenantId,
      },
      select: {
        id: true,
        title: true,
        message: true,
        productId: true,
        sentAt: true,
        createdAt: true,
      },
    }),
  );

  if (!promotion) {
    throw appError("PROMOTION_NOT_FOUND");
  }

  return promotion;
}

async function getBroadcastOrThrow(tenantId, broadcastId) {
  const broadcast = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.findFirst({
      where: {
        id: String(broadcastId),
        tenantId,
      },
      include: broadcastIncludeShape(),
    }),
  );

  if (!broadcast) {
    throw appError("BROADCAST_NOT_FOUND");
  }

  return broadcast;
}

function normalizeTargeting(body = {}) {
  const target = body.targeting && typeof body.targeting === "object" ? body.targeting : body;

  const mode = normalizeTargetMode(target.targetMode || target.mode || body.targetMode);

  const branchId = normalizeText(target.branchId || body.branchId);
  const productId = normalizeText(target.productId || body.productId);

  const manualCustomerIds = Array.isArray(target.customerIds || body.customerIds)
    ? (target.customerIds || body.customerIds).map(normalizeText).filter(Boolean)
    : [];

  return {
    mode,
    branchId,
    productId,
    manualCustomerIds,
  };
}

async function listBroadcasts({ tenantId, status, accountId, q, limit = 50 }) {
  await ensureTenantExists(tenantId);

  const cleanStatus = status ? normalizeStatus(status, "") : null;
  const cleanAccountId = normalizeText(accountId);
  const cleanQuery = normalizeText(q);
  const take = clampLimit(limit, 50, 100);

  const broadcasts = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.findMany({
      where: {
        tenantId,
        ...(cleanStatus ? { status: cleanStatus } : {}),
        ...(cleanAccountId ? { accountId: cleanAccountId } : {}),
        ...(cleanQuery
          ? {
              OR: [
                { templateName: { contains: cleanQuery, mode: "insensitive" } },
                { languageCode: { contains: cleanQuery, mode: "insensitive" } },
                {
                  promotion: {
                    is: {
                      OR: [
                        { title: { contains: cleanQuery, mode: "insensitive" } },
                        { message: { contains: cleanQuery, mode: "insensitive" } },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: broadcastIncludeShape(),
      orderBy: [{ createdAt: "desc" }],
      take,
    }),
  );

  return broadcasts.map(buildPublicBroadcast);
}

async function getBroadcast({ tenantId, broadcastId }) {
  await ensureTenantExists(tenantId);
  const broadcast = await getBroadcastOrThrow(tenantId, broadcastId);
  return buildPublicBroadcast(broadcast);
}

async function createBroadcast({ tenantId, userId, body }) {
  await ensureTenantExists(tenantId);

  const account = await getActiveAccountOrThrow(tenantId, body?.accountId || null);

  const promotionId = normalizeText(body?.promotionId);
  const templateName = normalizeText(body?.templateName);
  const languageCode = normalizeLanguageCode(body?.languageCode);

  if (!templateName) {
    throw appError("TEMPLATE_NAME_REQUIRED");
  }

  let promotion = null;
  if (promotionId) {
    promotion = await getPromotionOrThrow(tenantId, promotionId);
  }

  const targeting = normalizeTargeting(body || {});
  if (targeting.mode === "BRANCH_CUSTOMERS" && targeting.branchId) {
    await assertBranchBelongsToTenant(tenantId, targeting.branchId);
  }

  if (targeting.mode === "PRODUCT_BUYERS" && !targeting.productId && !promotion?.productId) {
    throw appError("PRODUCT_ID_REQUIRED_FOR_TARGET");
  }

  if (targeting.mode === "MANUAL_CUSTOMERS" && targeting.manualCustomerIds.length === 0) {
    throw appError("CUSTOMER_IDS_REQUIRED_FOR_TARGET");
  }

  const created = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.create({
      data: {
        tenantId,
        accountId: account.id,
        promotionId: promotion ? promotion.id : null,
        templateName,
        languageCode,
        status: "DRAFT",
        createdById: userId,
      },
      include: broadcastIncludeShape(),
    }),
  );

  return {
    ...buildPublicBroadcast(created),
    targetingPreview: {
      mode: targeting.mode,
      branchId: targeting.branchId,
      productId: targeting.productId || promotion?.productId || null,
      manualCustomerCount: targeting.manualCustomerIds.length,
      persisted: false,
      note:
        "Audience selection is applied when sending. Saved audience segments can be added later if needed.",
    },
  };
}

async function updateBroadcast({ tenantId, broadcastId, body }) {
  await ensureTenantExists(tenantId);

  const existing = await getBroadcastOrThrow(tenantId, broadcastId);

  if (existing.status !== "DRAFT") {
    throw appError("ONLY_DRAFT_CAN_BE_EDITED");
  }

  const nextTemplateName =
    body?.templateName !== undefined ? normalizeText(body.templateName) : existing.templateName;

  const nextLanguageCode =
    body?.languageCode !== undefined
      ? normalizeLanguageCode(body.languageCode)
      : existing.languageCode;

  if (!nextTemplateName) {
    throw appError("TEMPLATE_NAME_REQUIRED");
  }

  let nextAccountId = existing.accountId;
  if (body?.accountId !== undefined) {
    const account = await getActiveAccountOrThrow(tenantId, body.accountId);
    nextAccountId = account.id;
  }

  let nextPromotionId = existing.promotionId || null;
  if (body?.promotionId !== undefined) {
    const cleanPromotionId = normalizeText(body.promotionId);

    if (!cleanPromotionId) {
      nextPromotionId = null;
    } else {
      const promotion = await getPromotionOrThrow(tenantId, cleanPromotionId);
      nextPromotionId = promotion.id;
    }
  }

  const targeting = normalizeTargeting(body || {});
  if (targeting.mode === "BRANCH_CUSTOMERS" && targeting.branchId) {
    await assertBranchBelongsToTenant(tenantId, targeting.branchId);
  }

  const updated = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.update({
      where: { id: existing.id },
      data: {
        accountId: nextAccountId,
        promotionId: nextPromotionId,
        templateName: nextTemplateName,
        languageCode: nextLanguageCode,
      },
      include: broadcastIncludeShape(),
    }),
  );

  return {
    ...buildPublicBroadcast(updated),
    targetingPreview: {
      mode: targeting.mode,
      branchId: targeting.branchId,
      productId: targeting.productId || null,
      manualCustomerCount: targeting.manualCustomerIds.length,
      persisted: false,
    },
  };
}

async function queueBroadcast({ tenantId, broadcastId }) {
  await ensureTenantExists(tenantId);

  const existing = await getBroadcastOrThrow(tenantId, broadcastId);

  if (existing.status !== "DRAFT") {
    throw appError("ONLY_DRAFT_CAN_BE_QUEUED");
  }

  const updated = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.update({
      where: { id: existing.id },
      data: {
        status: "QUEUED",
        queuedAt: new Date(),
      },
      include: broadcastIncludeShape(),
    }),
  );

  return buildPublicBroadcast(updated);
}

async function getBranchCustomerIds({ tenantId, branchId, limit }) {
  await assertBranchBelongsToTenant(tenantId, branchId);

  const saleFields = getModelFields(prisma.sale);

  if (typeof saleFields.branchId === "undefined") {
    throw appError("SALE_BRANCH_NOT_AVAILABLE");
  }

  const rows = await withPrismaRetry(() =>
    prisma.sale.findMany({
      where: {
        tenantId,
        branchId,
        customerId: { not: null },
        isDraft: false,
        isCancelled: false,
      },
      select: {
        customerId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(1000, Math.max(limit * 4, limit)),
    }),
  );

  return [...new Set(rows.map((row) => row.customerId).filter(Boolean))].slice(0, limit);
}

async function getCreditCustomerIds({ tenantId, overdueOnly = false, limit }) {
  const now = new Date();

  const rows = await withPrismaRetry(() =>
    prisma.sale.findMany({
      where: {
        tenantId,
        customerId: { not: null },
        isDraft: false,
        isCancelled: false,
        saleType: "CREDIT",
        balanceDue: { gt: 0 },
        ...(overdueOnly ? { dueDate: { lt: now } } : {}),
      },
      select: {
        customerId: true,
        balanceDue: true,
        dueDate: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(1000, Math.max(limit * 4, limit)),
    }),
  );

  return [...new Set(rows.map((row) => row.customerId).filter(Boolean))].slice(0, limit);
}

async function getProductBuyerCustomerIds({ tenantId, productId, limit }) {
  if (!productId) throw appError("PRODUCT_ID_REQUIRED_FOR_TARGET");

  const product = await withPrismaRetry(() =>
    prisma.product.findFirst({
      where: {
        id: String(productId),
        tenantId,
      },
      select: {
        id: true,
      },
    }),
  );

  if (!product) throw appError("PRODUCT_NOT_FOUND");

  const rows = await withPrismaRetry(() =>
    prisma.saleItem.findMany({
      where: {
        productId: product.id,
        sale: {
          tenantId,
          customerId: { not: null },
          isDraft: false,
          isCancelled: false,
        },
      },
      select: {
        sale: {
          select: {
            customerId: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ id: "desc" }],
      take: Math.min(1000, Math.max(limit * 4, limit)),
    }),
  );

  return [...new Set(rows.map((row) => row.sale?.customerId).filter(Boolean))].slice(0, limit);
}

async function getRecipients({ tenantId, targeting, promotion, limit }) {
  const customerFields = getModelFields(prisma.customer);
  const take = clampLimit(limit, 50, 200);

  let customerIds = [];

  if (targeting.mode === "BRANCH_CUSTOMERS") {
    if (!targeting.branchId) throw appError("BRANCH_REQUIRED");
    customerIds = await getBranchCustomerIds({
      tenantId,
      branchId: targeting.branchId,
      limit: take,
    });
  }

  if (targeting.mode === "CREDIT_CUSTOMERS") {
    customerIds = await getCreditCustomerIds({
      tenantId,
      overdueOnly: false,
      limit: take,
    });
  }

  if (targeting.mode === "OVERDUE_CREDIT_CUSTOMERS") {
    customerIds = await getCreditCustomerIds({
      tenantId,
      overdueOnly: true,
      limit: take,
    });
  }

  if (targeting.mode === "PRODUCT_BUYERS") {
    customerIds = await getProductBuyerCustomerIds({
      tenantId,
      productId: targeting.productId || promotion?.productId,
      limit: take,
    });
  }

  if (targeting.mode === "MANUAL_CUSTOMERS") {
    customerIds = targeting.manualCustomerIds.slice(0, take);
  }

  const where =
    targeting.mode === "ALL_OPTED_IN"
      ? buildCustomerWhereBase(tenantId)
      : {
          ...buildCustomerWhereBase(tenantId),
          id: { in: customerIds },
        };

  const recipients = await withPrismaRetry(() =>
    prisma.customer.findMany({
      where,
      select: customerSelectShape(),
      orderBy:
        typeof customerFields.createdAt !== "undefined"
          ? [{ createdAt: "desc" }]
          : [{ name: "asc" }],
      take,
    }),
  );

  const seenPhones = new Set();
  const cleanRecipients = [];

  for (const customer of recipients) {
    const phone = normalizePhone(customer.phone);
    if (!phone) continue;
    if (seenPhones.has(phone)) continue;

    seenPhones.add(phone);
    cleanRecipients.push({
      id: customer.id,
      name: customer.name || "Customer",
      phone,
    });
  }

  return cleanRecipients;
}

async function findOrCreateConversation({ tenantId, account, recipient }) {
  let conversation = await withPrismaRetry(() =>
    prisma.whatsAppConversation.findFirst({
      where: {
        tenantId,
        accountId: account.id,
        phone: recipient.phone,
      },
      select: {
        id: true,
        customerId: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  );

  if (!conversation) {
    const conversationFields = getModelFields(prisma.whatsAppConversation);

    conversation = await withPrismaRetry(() =>
      prisma.whatsAppConversation.create({
        data: {
          tenantId,
          accountId: account.id,
          customerId: recipient.id,
          phone: recipient.phone,
          status: "OPEN",
          ...(typeof conversationFields.branchId !== "undefined" ? { branchId: null } : {}),
        },
        select: {
          id: true,
          customerId: true,
        },
      }),
    );
  } else if (!conversation.customerId) {
    await withPrismaRetry(() =>
      prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: {
          customerId: recipient.id,
          updatedAt: new Date(),
        },
      }),
    );
  }

  return conversation;
}

async function sendBroadcastNow({ tenantId, broadcastId, limit = 50, targeting: targetingInput = null }) {
  await ensureTenantExists(tenantId);

  const broadcast = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.findFirst({
      where: {
        id: String(broadcastId),
        tenantId,
      },
      include: {
        account: true,
        promotion: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        messages: {
          select: {
            id: true,
            conversationId: true,
          },
        },
      },
    }),
  );

  if (!broadcast) {
    throw appError("BROADCAST_NOT_FOUND");
  }

  if (broadcast.status !== "DRAFT" && broadcast.status !== "QUEUED" && broadcast.status !== "FAILED") {
    throw appError("ONLY_DRAFT_OR_QUEUED_CAN_BE_SENT");
  }

  if (!broadcast.promotion) {
    throw appError("PROMOTION_REQUIRED_TO_SEND");
  }

  const account = await getActiveAccountOrThrow(tenantId, broadcast.accountId);

  const targeting = normalizeTargeting(targetingInput || {});
  const recipients = await getRecipients({
    tenantId,
    targeting,
    promotion: broadcast.promotion,
    limit,
  });

  if (!recipients.length) {
    throw appError("NO_BROADCAST_RECIPIENTS");
  }

  const sentConversationIds = new Set(
    Array.isArray(broadcast.messages)
      ? broadcast.messages.map((m) => String(m.conversationId || "")).filter(Boolean)
      : [],
  );

  let attempted = 0;
  let delivered = 0;
  let failed = 0;
  let skippedDuplicate = 0;

  const failures = [];

  for (const recipient of recipients) {
    attempted += 1;

    try {
      const conversation = await findOrCreateConversation({
        tenantId,
        account,
        recipient,
      });

      if (sentConversationIds.has(conversation.id)) {
        skippedDuplicate += 1;
        continue;
      }

      const resp = await whatsappService.sendTemplate({
        account,
        to: recipient.phone,
        templateName: broadcast.templateName,
        languageCode: broadcast.languageCode,
        bodyParams: [
          recipient.name || "Customer",
          broadcast.promotion.title || "Offer",
          broadcast.promotion.message || "",
        ],
      });

      const providerMessageId = resp?.messages?.[0]?.id || null;

      await withPrismaRetry(() =>
        prisma.whatsAppMessage.create({
          data: {
            conversationId: conversation.id,
            tenantId,
            accountId: account.id,
            broadcastId: broadcast.id,
            direction: "OUTBOUND",
            type: "TEXT",
            textContent: broadcast.promotion.message || "",
            messageId: providerMessageId,
          },
        }),
      );

      await withPrismaRetry(() =>
        prisma.whatsAppConversation.update({
          where: { id: conversation.id },
          data: {
            updatedAt: new Date(),
            customerId: recipient.id,
          },
        }),
      );

      delivered += 1;
      sentConversationIds.add(conversation.id);
    } catch (err) {
      console.error("sendBroadcastNow recipient send error:", err?.message || err);
      failed += 1;

      failures.push({
        customerId: recipient.id,
        phone: recipient.phone,
        message: friendlySendFailure(err),
      });
    }
  }

  const nextStatus = delivered > 0 ? "SENT" : "FAILED";
  const sentAt = delivered > 0 ? new Date() : null;

  const updated = await withPrismaRetry(() =>
    prisma.whatsAppBroadcast.update({
      where: { id: broadcast.id },
      data: {
        status: nextStatus,
        ...(sentAt ? { sentAt } : {}),
        queuedAt: broadcast.queuedAt || new Date(),
      },
      include: broadcastIncludeShape(),
    }),
  );

  if (delivered > 0 && broadcast.promotion && !broadcast.promotion.sentAt) {
    await withPrismaRetry(() =>
      prisma.promotion.update({
        where: { id: broadcast.promotion.id },
        data: { sentAt: new Date() },
      }),
    );
  }

  return {
    broadcast: buildPublicBroadcast(updated),
    summary: {
      targetMode: targeting.mode,
      branchId: targeting.branchId || null,
      productId: targeting.productId || broadcast.promotion?.productId || null,
      attempted,
      delivered,
      failed,
      skippedDuplicate,
      failurePreview: failures.slice(0, 10),
    },
  };
}

module.exports = {
  listBroadcasts,
  getBroadcast,
  createBroadcast,
  updateBroadcast,
  queueBroadcast,
  sendBroadcastNow,
};