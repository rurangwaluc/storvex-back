const prisma = require("../../config/database");
const whatsappService = require("./whatsapp.service");

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
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

function buildPublicBroadcast(broadcast) {
  if (!broadcast) return null;

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
    recipientCount: Array.isArray(broadcast.messages) ? broadcast.messages.length : 0,
    deliveredCount: Array.isArray(broadcast.messages)
      ? broadcast.messages.filter((m) => String(m.messageId || "").trim()).length
      : 0,
  };
}

async function ensureTenantExists(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  return tenant;
}

async function getActiveAccountOrThrow(tenantId, accountId) {
  const where = {
    tenantId,
    isActive: true,
    ...(accountId ? { id: String(accountId) } : {}),
  };

  const account = await prisma.whatsAppAccount.findFirst({
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
  });

  if (!account) {
    throw new Error("WHATSAPP_ACCOUNT_NOT_FOUND");
  }

  if (!account.phoneNumberId) {
    throw new Error("WHATSAPP_ACCOUNT_PHONE_NUMBER_ID_MISSING");
  }

  if (!account.accessToken) {
    throw new Error("WHATSAPP_ACCOUNT_ACCESS_TOKEN_MISSING");
  }

  return account;
}

async function getPromotionOrThrow(tenantId, promotionId) {
  const promotion = await prisma.promotion.findFirst({
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
  });

  if (!promotion) {
    throw new Error("PROMOTION_NOT_FOUND");
  }

  return promotion;
}

async function getBroadcastOrThrow(tenantId, broadcastId) {
  const broadcast = await prisma.whatsAppBroadcast.findFirst({
    where: {
      id: String(broadcastId),
      tenantId,
    },
    include: {
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
        },
      },
    },
  });

  if (!broadcast) {
    throw new Error("BROADCAST_NOT_FOUND");
  }

  return broadcast;
}

async function listBroadcasts({ tenantId, status, accountId, q, limit = 50 }) {
  await ensureTenantExists(tenantId);

  const cleanStatus = status ? normalizeStatus(status, "") : null;
  const cleanAccountId = normalizeText(accountId);
  const cleanQuery = normalizeText(q);
  const take = Math.min(100, Math.max(1, toInt(limit, 50)));

  const broadcasts = await prisma.whatsAppBroadcast.findMany({
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
    include: {
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
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take,
  });

  return broadcasts.map(buildPublicBroadcast);
}

async function getBroadcast({ tenantId, broadcastId }) {
  await ensureTenantExists(tenantId);
  const broadcast = await getBroadcastOrThrow(tenantId, broadcastId);
  return buildPublicBroadcast(broadcast);
}

async function createBroadcast({
  tenantId,
  userId,
  body,
}) {
  await ensureTenantExists(tenantId);

  const account = await getActiveAccountOrThrow(tenantId, body?.accountId || null);

  const promotionId = normalizeText(body?.promotionId);
  const templateName = normalizeText(body?.templateName);
  const languageCode = normalizeLanguageCode(body?.languageCode);

  if (!templateName) {
    throw new Error("TEMPLATE_NAME_REQUIRED");
  }

  let promotion = null;
  if (promotionId) {
    promotion = await getPromotionOrThrow(tenantId, promotionId);
  }

  const created = await prisma.whatsAppBroadcast.create({
    data: {
      tenantId,
      accountId: account.id,
      promotionId: promotion ? promotion.id : null,
      templateName,
      languageCode,
      status: "DRAFT",
      createdById: userId,
    },
    include: {
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
        },
      },
    },
  });

  return buildPublicBroadcast(created);
}

async function updateBroadcast({
  tenantId,
  broadcastId,
  body,
}) {
  await ensureTenantExists(tenantId);

  const existing = await getBroadcastOrThrow(tenantId, broadcastId);

  if (existing.status !== "DRAFT") {
    throw new Error("ONLY_DRAFT_CAN_BE_EDITED");
  }

  const nextTemplateName =
    body?.templateName !== undefined ? normalizeText(body.templateName) : existing.templateName;

  const nextLanguageCode =
    body?.languageCode !== undefined
      ? normalizeLanguageCode(body.languageCode)
      : existing.languageCode;

  if (!nextTemplateName) {
    throw new Error("TEMPLATE_NAME_REQUIRED");
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

  const updated = await prisma.whatsAppBroadcast.update({
    where: { id: existing.id },
    data: {
      accountId: nextAccountId,
      promotionId: nextPromotionId,
      templateName: nextTemplateName,
      languageCode: nextLanguageCode,
    },
    include: {
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
        },
      },
    },
  });

  return buildPublicBroadcast(updated);
}

async function queueBroadcast({ tenantId, broadcastId }) {
  await ensureTenantExists(tenantId);

  const existing = await getBroadcastOrThrow(tenantId, broadcastId);

  if (existing.status !== "DRAFT") {
    throw new Error("ONLY_DRAFT_CAN_BE_QUEUED");
  }

  const updated = await prisma.whatsAppBroadcast.update({
    where: { id: existing.id },
    data: {
      status: "QUEUED",
      queuedAt: new Date(),
    },
    include: {
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
        },
      },
    },
  });

  return buildPublicBroadcast(updated);
}

async function sendBroadcastNow({
  tenantId,
  broadcastId,
  limit = 50,
}) {
  await ensureTenantExists(tenantId);

  const broadcast = await prisma.whatsAppBroadcast.findFirst({
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
  });

  if (!broadcast) {
    throw new Error("BROADCAST_NOT_FOUND");
  }

  if (broadcast.status !== "DRAFT" && broadcast.status !== "QUEUED") {
    throw new Error("ONLY_DRAFT_OR_QUEUED_CAN_BE_SENT");
  }

  if (!broadcast.promotion) {
    throw new Error("PROMOTION_REQUIRED_TO_SEND");
  }

  const account = await getActiveAccountOrThrow(tenantId, broadcast.accountId);

  const recipients = await prisma.customer.findMany({
    where: {
      tenantId,
      isActive: true,
      whatsappOptIn: true,
      phone: { not: null },
    },
    select: {
      id: true,
      name: true,
      phone: true,
    },
    orderBy: [{ createdAt: "desc" }],
    take: Math.min(200, Math.max(1, toInt(limit, 50))),
  });

  if (!recipients.length) {
    throw new Error("NO_BROADCAST_RECIPIENTS");
  }

  const sentConversationIds = new Set(
    Array.isArray(broadcast.messages)
      ? broadcast.messages.map((m) => String(m.conversationId || "")).filter(Boolean)
      : []
  );

  let attempted = 0;
  let delivered = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const to = normalizePhone(recipient.phone);
    if (!to) continue;

    attempted += 1;

    try {
      let conversation = await prisma.whatsAppConversation.findFirst({
        where: {
          tenantId,
          accountId: account.id,
          phone: to,
        },
        select: { id: true },
        orderBy: [{ updatedAt: "desc" }],
      });

      if (!conversation) {
        conversation = await prisma.whatsAppConversation.create({
          data: {
            tenantId,
            accountId: account.id,
            customerId: recipient.id,
            phone: to,
            status: "OPEN",
          },
          select: { id: true },
        });
      }

      if (sentConversationIds.has(conversation.id)) {
        continue;
      }

      const resp = await whatsappService.sendTemplate({
        account,
        to,
        templateName: broadcast.templateName,
        languageCode: broadcast.languageCode,
        bodyParams: [
          recipient.name || "Customer",
          broadcast.promotion.title || "Offer",
          broadcast.promotion.message || "",
        ],
      });

      const providerMessageId = resp?.messages?.[0]?.id || null;

      await prisma.whatsAppMessage.create({
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
      });

      await prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: new Date(),
          customerId: recipient.id,
        },
      });

      delivered += 1;
      sentConversationIds.add(conversation.id);
    } catch (err) {
      console.error("sendBroadcastNow recipient send error:", err?.message || err);
      failed += 1;
    }
  }

  const nextStatus = delivered > 0 ? "SENT" : "FAILED";
  const sentAt = delivered > 0 ? new Date() : null;

  const updated = await prisma.whatsAppBroadcast.update({
    where: { id: broadcast.id },
    data: {
      status: nextStatus,
      ...(sentAt ? { sentAt } : {}),
      queuedAt: broadcast.queuedAt || new Date(),
    },
    include: {
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
        },
      },
    },
  });

  if (delivered > 0 && broadcast.promotion && !broadcast.promotion.sentAt) {
    await prisma.promotion.update({
      where: { id: broadcast.promotion.id },
      data: { sentAt: new Date() },
    });
  }

  return {
    broadcast: buildPublicBroadcast(updated),
    summary: {
      attempted,
      delivered,
      failed,
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