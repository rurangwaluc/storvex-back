const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");
const whatsappService = require("./whatsapp.service");
const { reserveSaleDocumentNumbersTx } = require("../documents/documentNumber.service");
const { WHATSAPP_ASSIGNABLE_ROLES } = require("./whatsapp.roles");

function appError(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function normalizeId(value) {
  const s = String(value || "").trim();
  return s || null;
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

  if (v === "CASH") return "CASH";
  if (v === "MOMO" || v === "MOBILE_MONEY" || v === "MTN_MOMO") return "MOMO";
  if (v === "BANK" || v === "BANK_TRANSFER" || v === "TRANSFER") return "BANK";
  if (v === "CARD" || v === "VISA" || v === "MASTERCARD") return "CARD";
  if (v === "OTHER") return "OTHER";

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
  try {
    return delegate?.fields || {};
  } catch {
    return {};
  }
}

function modelHasField(delegate, fieldName) {
  const fields = getModelFields(delegate);
  return typeof fields[fieldName] !== "undefined";
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
    ...(typeof saleFields.branchId !== "undefined" ? { branchId: true } : {}),
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

function buildConversationSelectShape(delegate = prisma.whatsAppConversation) {
  const conversationFields = getModelFields(delegate);

  return {
    id: true,
    tenantId: true,
    accountId: true,
    customerId: true,
    phone: true,
    status: true,
    assignedToId: true,
    createdAt: true,
    updatedAt: true,
    ...(typeof conversationFields.branchId !== "undefined" ? { branchId: true } : {}),
    account: {
      select: {
        id: true,
        phoneNumber: true,
        businessName: true,
        isActive: true,
      },
    },
    customer: {
      select: buildCustomerSelectShape(),
    },
    assignedTo: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
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

async function tableColumnExists(tableName, columnName) {
  const rows = await prisma.$queryRaw`
    select 1 as ok
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${String(tableName)}
      and column_name = ${String(columnName)}
    limit 1
  `;

  return Boolean(rows?.[0]?.ok);
}

let readStateTableChecked = false;
let readStateTableExists = false;

async function hasWhatsAppReadStateTable() {
  if (readStateTableChecked) return readStateTableExists;

  const rows = await prisma.$queryRaw`
    select to_regclass('public."WhatsAppConversationReadState"')::text as table_name
  `;

  readStateTableExists = Boolean(rows?.[0]?.table_name);
  readStateTableChecked = true;

  return readStateTableExists;
}

async function attachUnreadCountsToConversations({ tenantId, userId, conversations }) {
  if (!tenantId || !userId || !Array.isArray(conversations) || conversations.length === 0) {
    return conversations;
  }

  const tableExists = await hasWhatsAppReadStateTable();
  if (!tableExists) {
    return conversations.map((conversation) => ({
      ...conversation,
      unreadCount:
        conversation.latestMessage?.direction === "INBOUND"
          ? Math.max(1, Number(conversation.messageCount || 1))
          : 0,
    }));
  }

  const conversationIds = conversations.map((conversation) => String(conversation.id)).filter(Boolean);

  if (!conversationIds.length) {
    return conversations.map((conversation) => ({
      ...conversation,
      unreadCount: 0,
    }));
  }

  const rows = await prisma.$queryRaw`
    select
      c."id"::text as "conversationId",
      count(m."id")::int as "unreadCount"
    from public."WhatsAppConversation" c
    left join public."WhatsAppConversationReadState" rs
      on rs."tenantId" = c."tenantId"
      and rs."conversationId" = c."id"
      and rs."userId"::text = ${String(userId)}
    join public."WhatsAppMessage" m
      on m."tenantId" = c."tenantId"
      and m."conversationId" = c."id"
      and m."direction" = 'INBOUND'
      and (
        rs."lastReadAt" is null
        or m."createdAt" > rs."lastReadAt"
      )
    where c."tenantId"::text = ${String(tenantId)}
      and c."id"::text in (${Prisma.join(conversationIds)})
    group by c."id"
  `;

  const unreadByConversationId = new Map(
    (rows || []).map((row) => [
      String(row.conversationId),
      Number(row.unreadCount || 0),
    ])
  );

  return conversations.map((conversation) => ({
    ...conversation,
    unreadCount: unreadByConversationId.get(String(conversation.id)) || 0,
  }));
}

async function upsertConversationReadState({ tenantId, conversationId, userId }) {
  if (!tenantId || !conversationId || !userId) {
    return null;
  }

  const tableExists = await hasWhatsAppReadStateTable();
  if (!tableExists) return null;

  const latestRows = await prisma.$queryRaw`
    select
      m."id"::text as "id",
      m."createdAt" as "createdAt"
    from public."WhatsAppMessage" m
    where m."tenantId"::text = ${String(tenantId)}
      and m."conversationId"::text = ${String(conversationId)}
    order by m."createdAt" desc, m."id" desc
    limit 1
  `;

  const latestMessage = latestRows?.[0] || null;
  const latestMessageId = latestMessage?.id || null;
  const readAt = latestMessage?.createdAt || new Date();

  const rows = await prisma.$queryRaw`
    insert into public."WhatsAppConversationReadState"
      (
        "tenantId",
        "conversationId",
        "userId",
        "lastReadAt",
        "lastReadMessageId"
      )
    select
      c."tenantId",
      c."id",
      u."id",
      ${readAt}::timestamptz,
      lm."id"
    from public."WhatsAppConversation" c
    join public."User" u
      on u."tenantId"::text = ${String(tenantId)}
      and u."id"::text = ${String(userId)}
    left join public."WhatsAppMessage" lm
      on lm."tenantId" = c."tenantId"
      and lm."conversationId" = c."id"
      and lm."id"::text = ${String(latestMessageId || "__NO_MESSAGE__")}
    where c."tenantId"::text = ${String(tenantId)}
      and c."id"::text = ${String(conversationId)}
    on conflict ("tenantId", "conversationId", "userId")
    do update set
      "lastReadAt" = excluded."lastReadAt",
      "lastReadMessageId" = excluded."lastReadMessageId",
      "updatedAt" = now()
    returning
      "id"::text as "id",
      "tenantId"::text as "tenantId",
      "conversationId"::text as "conversationId",
      "userId"::text as "userId",
      "lastReadAt",
      "lastReadMessageId"::text as "lastReadMessageId",
      "updatedAt"
  `;

  return rows?.[0] || null;
}

async function getMainBranchId(db, tenantId) {
  if (!tenantId || !db.branch) return null;

  const main = await db.branch.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
      isMain: true,
    },
    select: {
      id: true,
    },
  });

  if (main?.id) return main.id;

  const first = await db.branch.findFirst({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
    },
  });

  return first?.id || null;
}

async function getUserBranchContext(db, { tenantId, userId }) {
  if (!tenantId || !userId || !db.user) {
    return {
      branchId: null,
      role: null,
      canViewAllBranches: false,
      allowedBranchIds: [],
    };
  }

  const userFields = getModelFields(db.user);

  const user = await db.user.findFirst({
    where: {
      id: String(userId),
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
      role: true,
      ...(typeof userFields.branchId !== "undefined" ? { branchId: true } : {}),
      ...(typeof userFields.defaultBranchId !== "undefined" ? { defaultBranchId: true } : {}),
      ...(typeof userFields.activeBranchId !== "undefined" ? { activeBranchId: true } : {}),
      ...(typeof userFields.canViewAllBranches !== "undefined"
        ? { canViewAllBranches: true }
        : {}),
    },
  });

  if (!user) {
    return {
      branchId: null,
      role: null,
      canViewAllBranches: false,
      allowedBranchIds: [],
    };
  }

  const role = String(user.role || "").toUpperCase();

  const branchId =
    normalizeId(user.activeBranchId) ||
    normalizeId(user.branchId) ||
    normalizeId(user.defaultBranchId) ||
    null;

  const canViewAllBranches =
    Boolean(user.canViewAllBranches) || role === "OWNER" || role === "MANAGER";

  return {
    branchId,
    role,
    canViewAllBranches,
    allowedBranchIds: branchId ? [branchId] : [],
  };
}

async function assertBranchBelongsToTenant(db, { tenantId, branchId }) {
  if (!tenantId || !branchId) throw appError("BRANCH_REQUIRED");

  const branch = await db.branch.findFirst({
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
  });

  if (!branch) throw appError("BRANCH_NOT_FOUND");

  return branch;
}

async function assertUserCanUseBranch(db, { tenantId, userId, branchId }) {
  const branch = await assertBranchBelongsToTenant(db, { tenantId, branchId });
  const access = await getUserBranchContext(db, { tenantId, userId });

  if (access.canViewAllBranches) {
    return branch;
  }

  if (access.branchId && access.branchId === branch.id) {
    return branch;
  }

  throw appError("BRANCH_ACCESS_DENIED");
}

async function resolveBusinessBranch(
  db,
  { tenantId, userId, requestedBranchId, conversation, sale }
) {
  const conversationFields = getModelFields(db.whatsAppConversation);
  const saleFields = getModelFields(db.sale);

  const fromRequest = normalizeId(requestedBranchId);

  const fromSale =
    typeof saleFields.branchId !== "undefined" ? normalizeId(sale?.branchId) : null;

  const fromConversation =
    typeof conversationFields.branchId !== "undefined"
      ? normalizeId(conversation?.branchId)
      : null;

  const userContext = await getUserBranchContext(db, { tenantId, userId });

  const branchId =
    fromRequest ||
    fromSale ||
    fromConversation ||
    userContext.branchId ||
    (await getMainBranchId(db, tenantId));

  if (!branchId) throw appError("BRANCH_REQUIRED");

  const branch = await assertUserCanUseBranch(db, {
    tenantId,
    userId,
    branchId,
  });

  return branch;
}

async function buildConversationBranchWhere({ tenantId, userId }) {
  const conversationFields = getModelFields(prisma.whatsAppConversation);
  const cleanUserId = normalizeId(userId);

  if (typeof conversationFields.branchId === "undefined") {
    if (!cleanUserId) return { tenantId };

    return {
      tenantId,
      OR: [
        { assignedToId: cleanUserId },
        { assignedToId: null },
      ],
    };
  }

  const access = await getUserBranchContext(prisma, {
    tenantId,
    userId: cleanUserId,
  });

  if (access.canViewAllBranches) {
    return { tenantId };
  }

  const visibility = [];

  if (cleanUserId) {
    visibility.push({ assignedToId: cleanUserId });
  }

  if (access.branchId) {
    visibility.push({ branchId: access.branchId });
  }

  visibility.push({ branchId: null });

  return {
    tenantId,
    OR: visibility,
  };
}

async function attachConversationBranchIfPossible(tx, { tenantId, conversationId, branchId }) {
  if (!conversationId || !branchId) return;

  if (!modelHasField(tx.whatsAppConversation, "branchId")) {
    return;
  }

  await tx.whatsAppConversation.updateMany({
    where: {
      id: String(conversationId),
      tenantId,
    },
    data: {
      branchId,
      updatedAt: new Date(),
    },
  });
}

async function getBranchStockRowsTx(tx, { tenantId, branchId, productIds }) {
  if (!tx.branchInventory || !branchId) return null;

  const rows = await tx.branchInventory.findMany({
    where: {
      tenantId,
      branchId,
      productId: {
        in: productIds,
      },
    },
    select: {
      productId: true,
      qtyOnHand: true,
    },
  });

  return new Map(rows.map((row) => [row.productId, Number(row.qtyOnHand || 0)]));
}

async function assertBranchStockAvailableTx(tx, { tenantId, branchId, items }) {
  const productIds = [...new Set(items.map((item) => String(item.productId)))];

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

  const productById = new Map(products.map((product) => [product.id, product]));

  for (const item of items) {
    const productId = String(item.productId);
    if (!productById.has(productId)) throw appError("PRODUCT_NOT_FOUND");
  }

  const branchStock = await getBranchStockRowsTx(tx, {
    tenantId,
    branchId,
    productIds,
  });

  for (const item of items) {
    const product = productById.get(String(item.productId));
    const needed = Number(item.quantity || 0);

    const available =
      branchStock instanceof Map
        ? Number(branchStock.get(product.id) || 0)
        : Number(product.stockQty || 0);

    if (available < needed) {
      throw appError("INSUFFICIENT_STOCK", {
        productId: product.id,
        productName: product.name,
        available,
        needed,
      });
    }
  }

  return {
    productById,
    usingBranchInventory: branchStock instanceof Map,
  };
}

async function decrementBranchStockTx(tx, { tenantId, branchId, items }) {
  for (const item of items) {
    const productId = String(item.productId);
    const qty = Number(item.quantity || 0);

    if (tx.branchInventory && branchId) {
      const updated = await tx.branchInventory.updateMany({
        where: {
          tenantId,
          branchId,
          productId,
          qtyOnHand: { gte: qty },
        },
        data: {
          qtyOnHand: {
            decrement: qty,
          },
        },
      });

      if (!updated || updated.count !== 1) {
        throw appError("INSUFFICIENT_STOCK");
      }

      continue;
    }

    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        tenantId,
        isActive: true,
        stockQty: { gte: qty },
      },
      data: {
        stockQty: {
          decrement: qty,
        },
      },
    });

    if (!updated || updated.count !== 1) {
      throw appError("INSUFFICIENT_STOCK");
    }
  }
}

async function getOpenCashSessionId(tx, tenantId, branchId = null) {
  const hasBranchId = await tableColumnExists("cash_sessions", "branch_id");

  if (hasBranchId && branchId) {
    const rows = await tx.$queryRaw`
      select id
      from public.cash_sessions
      where tenant_id::text = ${String(tenantId)}
        and branch_id::text = ${String(branchId)}
        and closed_at is null
      order by opened_at desc
      limit 1
    `;

    return rows?.[0]?.id || null;
  }

  const rows = await tx.$queryRaw`
    select id
    from public.cash_sessions
    where tenant_id::text = ${String(tenantId)}
      and closed_at is null
    order by opened_at desc
    limit 1
  `;

  return rows?.[0]?.id || null;
}

async function insertCashMovementIfPossible(
  tx,
  { tenantId, branchId = null, userId, sessionId, type, reason, amount, note }
) {
  if (!sessionId) return null;

  const amountBigInt = BigInt(Math.round(Number(amount || 0)));
  const hasBranchId = await tableColumnExists("cash_movements", "branch_id");

  if (hasBranchId && branchId) {
    const rows = await tx.$queryRaw`
      insert into public.cash_movements
        (tenant_id, branch_id, session_id, type, reason, amount, note, created_by)
      values
        (
          ${String(tenantId)}::uuid,
          ${String(branchId)}::uuid,
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
    branchId: conversation.branchId || null,
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

async function listConversations({ tenantId, userId = null }) {
  const where = await buildConversationBranchWhere({ tenantId, userId });

  const conversations = await prisma.whatsAppConversation.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      ...buildConversationSelectShape(prisma.whatsAppConversation),
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

  const mapped = conversations.map(mapConversationListItem);

  return attachUnreadCountsToConversations({
    tenantId,
    userId,
    conversations: mapped,
  });
}

async function listMessages({ tenantId, conversationId, userId = null }) {
  const baseWhere = await buildConversationBranchWhere({ tenantId, userId });

  const convo = await prisma.whatsAppConversation.findFirst({
    where: {
      ...baseWhere,
      id: conversationId,
    },
    select: buildConversationSelectShape(prisma.whatsAppConversation),
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

  if (userId) {
    try {
      await upsertConversationReadState({
        tenantId,
        conversationId,
        userId,
      });
    } catch (err) {
      console.error("WhatsApp mark read from listMessages failed:", err?.message || err);
    }
  }

  return { conversationId, conversation: convo, messages };
}

async function reply({ tenantId, conversationId, userId, text }) {
  const cleanText = normalizeText(text);
  if (!cleanText) throw appError("TEXT_REQUIRED");

  const baseWhere = await buildConversationBranchWhere({ tenantId, userId });

  const convo = await prisma.whatsAppConversation.findFirst({
    where: {
      ...baseWhere,
      id: conversationId,
    },
    select: {
      id: true,
      phone: true,
      accountId: true,
      ...(modelHasField(prisma.whatsAppConversation, "branchId") ? { branchId: true } : {}),
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
        branchId: convo.branchId || null,
        phone: convo.phone,
        textLength: cleanText.length,
        providerMessageId: metaMsgId,
      },
    });

    return saved;
  });

  if (userId) {
    try {
      await upsertConversationReadState({
        tenantId,
        conversationId: convo.id,
        userId,
      });
    } catch (err) {
      console.error("WhatsApp mark read after reply failed:", err?.message || err);
    }
  }

  return { sent: true, message: result };
}

async function updateStatus({ tenantId, conversationId, status, userId = null }) {
  const normalizedStatus = normalizeConversationStatus(status);
  const baseWhere = await buildConversationBranchWhere({ tenantId, userId });

  const convo = await prisma.whatsAppConversation.findFirst({
    where: {
      ...baseWhere,
      id: conversationId,
    },
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

  const where = {
    id: saleId,
    tenantId,
    isCancelled: false,
  };

  if (
    typeof saleFields.isDraft !== "undefined" &&
    typeof saleFields.draftSource !== "undefined" &&
    typeof saleFields.conversationId !== "undefined"
  ) {
    where.OR = [
      {
        isDraft: true,
        draftSource: "WHATSAPP",
      },
      {
        isDraft: false,
        conversationId: {
          not: null,
        },
      },
    ];
  } else if (
    typeof saleFields.isDraft !== "undefined" &&
    typeof saleFields.draftSource !== "undefined"
  ) {
    where.isDraft = true;
    where.draftSource = "WHATSAPP";
  } else if (typeof saleFields.isDraft !== "undefined") {
    where.isDraft = true;
  }

  const draft = await tx.sale.findFirst({
    where,
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

async function listSaleDrafts({ tenantId, userId = null, branchId = null }) {
  const saleFields = getModelFields(prisma.sale);
  const access = await getUserBranchContext(prisma, { tenantId, userId });

  const where = {
    tenantId,
    ...(typeof saleFields.isDraft !== "undefined" ? { isDraft: true } : {}),
    ...(typeof saleFields.draftSource !== "undefined" ? { draftSource: "WHATSAPP" } : {}),
    isCancelled: false,
  };

  if (typeof saleFields.branchId !== "undefined") {
    const requestedBranchId = normalizeId(branchId);

    if (requestedBranchId) {
      await assertUserCanUseBranch(prisma, { tenantId, userId, branchId: requestedBranchId });
      where.branchId = requestedBranchId;
    } else if (!access.canViewAllBranches && access.branchId) {
      where.branchId = access.branchId;
    } else if (!access.canViewAllBranches && !access.branchId) {
      where.branchId = null;
    }
  }

  return prisma.sale.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: buildDraftSaleSelectShape(prisma.sale),
  });
}

async function getSaleDraft({ tenantId, saleId, userId = null }) {
  const draft = await getSaleDraftTx(prisma, tenantId, saleId);

  if (draft.branchId) {
    await assertUserCanUseBranch(prisma, {
      tenantId,
      userId,
      branchId: draft.branchId,
    });
  }

  return draft;
}

async function createSaleDraft({ tenantId, conversationId, userId, body }) {
  const conversationFields = getModelFields(prisma.whatsAppConversation);
  const baseWhere = await buildConversationBranchWhere({ tenantId, userId });

  const convo = await prisma.whatsAppConversation.findFirst({
    where: {
      ...baseWhere,
      id: conversationId,
    },
    select: {
      id: true,
      phone: true,
      customerId: true,
      assignedToId: true,
      tenantId: true,
      ...(typeof conversationFields.branchId !== "undefined" ? { branchId: true } : {}),
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

  const branch = await resolveBusinessBranch(prisma, {
    tenantId,
    userId,
    requestedBranchId: body?.branchId,
    conversation: convo,
    sale: null,
  });

  const normalizedRequestItems = items.map((item) => ({
    productId: String(item.productId),
    quantity: toInt(item.quantity),
    unitPrice: toNumber(item.unitPrice, NaN),
  }));

  const result = await prisma.$transaction(
    async (tx) => {
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

      await attachConversationBranchIfPossible(tx, {
        tenantId,
        conversationId: convo.id,
        branchId: branch.id,
      });

      const { productById } = await assertBranchStockAvailableTx(tx, {
        tenantId,
        branchId: branch.id,
        items: normalizedRequestItems,
      });

      let total = 0;
      const normalizedItems = [];

      for (const item of normalizedRequestItems) {
        const product = productById.get(item.productId);

        const unitPrice =
          Number.isFinite(item.unitPrice) && item.unitPrice > 0
            ? item.unitPrice
            : Number(product.sellPrice || 0);

        total += unitPrice * item.quantity;

        normalizedItems.push({
          productId: item.productId,
          quantity: item.quantity,
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
          ...(typeof saleFields.branchId !== "undefined" ? { branchId: branch.id } : {}),
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
          total: true,
          customerId: true,
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

      return {
        created: true,
        draft: {
          id: sale.id,
          total: sale.total,
          customerId: sale.customerId || null,
        },
        branch,
        audit: {
          source: "WHATSAPP",
          conversationId: convo.id,
          branchId: branch.id,
          branchName: branch.name,
          itemCount: normalizedItems.length,
          saleType: requestedSaleType,
          total,
          customerId: resolvedCustomerId || null,
        },
      };
    },
    {
      maxWait: 15000,
      timeout: 45000,
    }
  );

  createAuditLogTx(prisma, {
    tenantId,
    userId,
    entity: "SALE",
    entityId: result.draft.id,
    action: "WHATSAPP_SALE_DRAFT_CREATED",
    metadata: result.audit,
  }).catch((err) => {
    console.error("WhatsApp draft audit log failed:", err?.message || err);
  });

  return {
    created: true,
    draft: {
      id: result.draft.id,
    },
    branch: result.branch,
  };
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
      conversationId: true,
      ...(typeof saleFields.branchId !== "undefined" ? { branchId: true } : {}),
      conversation: {
        select: {
          id: true,
          phone: true,
          ...(modelHasField(prisma.whatsAppConversation, "branchId") ? { branchId: true } : {}),
        },
      },
    },
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");

  const branch = await resolveBusinessBranch(prisma, {
    tenantId,
    userId,
    requestedBranchId: body?.branchId,
    conversation: draft.conversation || null,
    sale: draft,
  });

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

      const saleTxFields = getModelFields(tx.sale);

      const patch = {
        ...(typeof saleTxFields.branchId !== "undefined" ? { branchId: branch.id } : {}),
      };

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

      await attachConversationBranchIfPossible(tx, {
        tenantId,
        conversationId: draft.conversationId,
        branchId: branch.id,
      });

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

        const normalizedItems = items.map((item) => ({
          productId: String(item.productId),
          quantity: toInt(item.quantity),
          unitPrice: toNumber(item.unitPrice, NaN),
        }));

        const { productById } = await assertBranchStockAvailableTx(tx, {
          tenantId,
          branchId: branch.id,
          items: normalizedItems,
        });

        await tx.saleItem.deleteMany({
          where: { saleId: draft.id },
        });

        for (const item of normalizedItems) {
          const product = productById.get(item.productId);

          const unitPrice =
            Number.isFinite(item.unitPrice) && item.unitPrice > 0
              ? item.unitPrice
              : Number(product.sellPrice || 0);

          await tx.saleItem.create({
            data: {
              saleId: draft.id,
              productId: item.productId,
              quantity: item.quantity,
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
          branchId: branch.id,
          branchName: branch.name,
          hasItemsPatch: body?.items !== undefined,
          hasCustomerPatch: Boolean(body?.customerId || body?.customer),
          hasSaleTypePatch: body?.saleType !== undefined,
          hasDueDatePatch: body?.dueDate !== undefined,
        },
      });

      return {
        updated: true,
        draft: recomputed,
        branch,
      };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );
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
      ...(typeof saleFields.branchId !== "undefined" ? { branchId: true } : {}),
    },
  });

  if (!draft) throw appError("SALE_DRAFT_NOT_FOUND");

  if (draft.branchId) {
    await assertUserCanUseBranch(prisma, {
      tenantId,
      userId,
      branchId: draft.branchId,
    });
  }

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
        branchId: draft.branchId || null,
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
      ...(typeof saleFields.branchId !== "undefined" ? { branchId: true } : {}),
      total: true,
      saleType: true,
      dueDate: true,
      customerId: true,
      conversationId: true,
      conversation: {
        select: {
          id: true,
          phone: true,
          ...(modelHasField(prisma.whatsAppConversation, "branchId") ? { branchId: true } : {}),
        },
      },
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

  const branch = await resolveBusinessBranch(prisma, {
    tenantId,
    userId,
    requestedBranchId: body?.branchId,
    conversation: draft.conversation || null,
    sale: draft,
  });

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
  const saleTotal = Number(draft.total || 0);

  const initialPaid =
    finalSaleType === "CASH"
      ? saleTotal
      : Math.min(requestedPaid, saleTotal);

  if (requestedPaid > saleTotal + 0.000001) {
    throw appError("PAYMENT_EXCEEDS_TOTAL");
  }

  let precheckedOpenCashSessionId = null;

  const paymentTouchesCashDrawer = method === "CASH" && initialPaid > 0;

  if (paymentTouchesCashDrawer) {
    const blockCashSales = await tenantBlocksCashSales(prisma, tenantId);

    if (blockCashSales) {
      precheckedOpenCashSessionId = await getOpenCashSessionId(
        prisma,
        tenantId,
        branch.id
      );

      if (!precheckedOpenCashSessionId) {
        throw appError("CASH_DRAWER_CLOSED", { code: "CASH_DRAWER_CLOSED" });
      }
    } else {
      precheckedOpenCashSessionId = await getOpenCashSessionId(
        prisma,
        tenantId,
        branch.id
      );
    }
  }

  const stockItems = draft.items.map((item) => ({
    productId: item.productId,
    quantity: Number(item.quantity || 0),
  }));

  const result = await prisma.$transaction(
    async (tx) => {
      await assertBranchStockAvailableTx(tx, {
        tenantId,
        branchId: branch.id,
        items: stockItems,
      });

      await decrementBranchStockTx(tx, {
        tenantId,
        branchId: branch.id,
        items: stockItems,
      });

      await attachConversationBranchIfPossible(tx, {
        tenantId,
        conversationId: draft.conversationId,
        branchId: branch.id,
      });

      let resolvedCustomerId = draft.customerId || null;

      if (body?.customerId || body?.customer) {
        resolvedCustomerId = await resolveOrCreateCustomerTx(tx, tenantId, {
          customerId: body?.customerId || null,
          customer: body?.customer || null,
          conversation: null,
        });
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

      const saleTxFields = getModelFields(tx.sale);

      const updatedSale = await tx.sale.update({
        where: { id: draft.id },
        data: {
          customerId: resolvedCustomerId || null,
          ...(typeof saleTxFields.branchId !== "undefined" ? { branchId: branch.id } : {}),
          saleType: finalSaleType,
          amountPaid: initialPaid,
          balanceDue,
          status,
          dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
          receiptNumber: doc.receiptNumber,
          invoiceNumber: doc.invoiceNumber,
          ...(typeof saleTxFields.isDraft !== "undefined" ? { isDraft: false } : {}),
          ...(typeof saleTxFields.draftSource !== "undefined" ? { draftSource: null } : {}),
          ...(typeof saleTxFields.finalizedAt !== "undefined" ? { finalizedAt } : {}),
        },
        select: {
          id: true,
          ...(typeof saleTxFields.branchId !== "undefined" ? { branchId: true } : {}),
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
          ...(typeof saleTxFields.isDraft !== "undefined" ? { isDraft: true } : {}),
          ...(typeof saleTxFields.draftSource !== "undefined" ? { draftSource: true } : {}),
          ...(typeof saleTxFields.finalizedAt !== "undefined" ? { finalizedAt: true } : {}),
        },
      });

      let payment = null;
      let movement = null;

      if (initialPaid > 0) {
        const noteBase = normalizeText(body?.note);

        const safeNote = noteBase
          ? `${noteBase} - ${draft.id} - ${Date.now()}`
          : `WhatsApp payment - ${draft.id} - ${Date.now()}`;

        const paymentFields = getModelFields(tx.salePayment);

        payment = await tx.salePayment.create({
          data: {
            saleId: draft.id,
            tenantId,
            ...(typeof paymentFields.branchId !== "undefined" ? { branchId: branch.id } : {}),
            receivedById: userId || null,
            amount: initialPaid,
            method,
            note: safeNote,
          },
          select: {
            id: true,
            amount: true,
            method: true,
            createdAt: true,
            note: true,
            ...(typeof paymentFields.branchId !== "undefined" ? { branchId: true } : {}),
          },
        });

        if (paymentTouchesCashDrawer) {
          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            branchId: branch.id,
            userId,
            sessionId: precheckedOpenCashSessionId,
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
        branch,
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
        audit: {
          source: "WHATSAPP",
          conversationId: draft.conversationId || null,
          branchId: branch.id,
          branchName: branch.name,
          saleType: finalSaleType,
          total: draft.total,
          amountPaid: initialPaid,
          paymentMethod: initialPaid > 0 ? method : null,
          receiptNumber: updatedSale.receiptNumber || null,
          invoiceNumber: updatedSale.invoiceNumber || null,
          customerId: resolvedCustomerId || null,
        },
      };
    },
    {
      maxWait: 15000,
      timeout: 45000,
    }
  );

  createAuditLogTx(prisma, {
    tenantId,
    userId,
    entity: "SALE",
    entityId: draft.id,
    action: "WHATSAPP_SALE_DRAFT_FINALIZED",
    metadata: result.audit,
  }).catch((err) => {
    console.error("WhatsApp finalize audit log failed:", err?.message || err);
  });

  return {
    finalized: result.finalized,
    sale: result.sale,
    branch: result.branch,
    payment: result.payment,
    cashMovement: result.cashMovement,
  };
}

function normalizeConversationPublic(conversation) {
  if (!conversation) return null;

  return {
    id: conversation.id,
    tenantId: conversation.tenantId,
    accountId: conversation.accountId,
    customerId: conversation.customerId,
    branchId: conversation.branchId || null,
    phone: conversation.phone,
    status: conversation.status,
    assignedToId: conversation.assignedToId || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    account: conversation.account
      ? {
          id: conversation.account.id,
          phoneNumber: conversation.account.phoneNumber || null,
          businessName: conversation.account.businessName || null,
          isActive: Boolean(conversation.account.isActive),
        }
      : null,
    customer: conversation.customer
      ? {
          id: conversation.customer.id,
          name: conversation.customer.name || null,
          phone: conversation.customer.phone || null,
          email: conversation.customer.email || null,
        }
      : null,
    assignedTo: conversation.assignedTo
      ? {
          id: conversation.assignedTo.id,
          name: conversation.assignedTo.name || null,
          email: conversation.assignedTo.email || null,
          role: conversation.assignedTo.role || null,
          isActive: Boolean(conversation.assignedTo.isActive),
        }
      : null,
  };
}

/**
 * Do not write unsupported enum values into auditLog.action.
 * Your Prisma AuditAction enum may not include custom WhatsApp assignment action names yet.
 */
async function createAuditLogSafe({
  tenantId,
  userId = null,
  entity = "WHATSAPP_CONVERSATION",
  entityId = null,
  action,
  metadata = null,
}) {
  try {
    if (!action) return;

    await createAuditLogTx(prisma, {
      tenantId,
      userId,
      entity,
      entityId,
      action,
      metadata,
    });
  } catch (err) {
    console.error("WHATSAPP inbox audit log error:", err?.message || err);
  }
}

async function getConversationForTenant({ tenantId, conversationId, userId = null }) {
  const id = normalizeId(conversationId);
  if (!tenantId || !id) throw appError("INVALID_ARGS");

  const baseWhere = await buildConversationBranchWhere({ tenantId, userId });

  const conversation = await prisma.whatsAppConversation.findFirst({
    where: {
      ...baseWhere,
      id,
    },
    select: buildConversationSelectShape(prisma.whatsAppConversation),
  });

  if (!conversation) {
    throw appError("CONVERSATION_NOT_FOUND");
  }

  return conversation;
}

async function resolveAssignableUser({ tenantId, userId }) {
  const id = normalizeId(userId);
  if (!tenantId || !id) throw appError("INVALID_ASSIGNEE");

  const user = await prisma.user.findFirst({
    where: {
      id,
      tenantId,
      isActive: true,
      role: {
        in: WHATSAPP_ASSIGNABLE_ROLES,
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    throw appError("ASSIGNEE_NOT_FOUND");
  }

  return user;
}

async function listAssignableStaff({ tenantId }) {
  if (!tenantId) throw appError("INVALID_ARGS");

  const users = await prisma.user.findMany({
    where: {
      tenantId,
      isActive: true,
      role: {
        in: WHATSAPP_ASSIGNABLE_ROLES,
      },
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
    },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    role: user.role || "",
    isActive: Boolean(user.isActive),
  }));
}

async function assignConversation({
  tenantId,
  conversationId,
  assignedToId,
  actorUserId,
}) {
  const cleanAssignedToId = normalizeId(assignedToId);

  if (!cleanAssignedToId) {
    throw appError("ASSIGNED_TO_REQUIRED");
  }

  const conversation = await getConversationForTenant({
    tenantId,
    conversationId,
    userId: actorUserId,
  });

  const assignee = await resolveAssignableUser({
    tenantId,
    userId: cleanAssignedToId,
  });

  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      assignedToId: assignee.id,
      updatedAt: new Date(),
    },
    select: buildConversationSelectShape(prisma.whatsAppConversation),
  });

  await createAuditLogSafe({
    tenantId,
    userId: actorUserId || null,
    entity: "WHATSAPP_CONVERSATION",
    entityId: conversation.id,
    action: "WHATSAPP_CONVERSATION_ASSIGNED",
    metadata: {
      previousAssignedToId: conversation.assignedToId || null,
      nextAssignedToId: assignee.id,
      phone: conversation.phone,
      branchId: conversation.branchId || null,
    },
  });

  return {
    conversation: normalizeConversationPublic(updated),
  };
}

async function unassignConversation({
  tenantId,
  conversationId,
  actorUserId,
}) {
  const conversation = await getConversationForTenant({
    tenantId,
    conversationId,
    userId: actorUserId,
  });

  const updated = await prisma.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      assignedToId: null,
      updatedAt: new Date(),
    },
    select: buildConversationSelectShape(prisma.whatsAppConversation),
  });

  await createAuditLogSafe({
    tenantId,
    userId: actorUserId || null,
    entity: "WHATSAPP_CONVERSATION",
    entityId: conversation.id,
    action: "WHATSAPP_CONVERSATION_UNASSIGNED",
    metadata: {
      previousAssignedToId: conversation.assignedToId || null,
      phone: conversation.phone,
      branchId: conversation.branchId || null,
    },
  });

  return {
    conversation: normalizeConversationPublic(updated),
  };
}

async function markConversationRead({ tenantId, conversationId, userId }) {
  if (!tenantId || !conversationId || !userId) {
    throw appError("INVALID_ARGS");
  }

  const conversation = await getConversationForTenant({
    tenantId,
    conversationId,
    userId,
  });

  const readState = await upsertConversationReadState({
    tenantId,
    conversationId: conversation.id,
    userId,
  });

  return {
    ok: true,
    conversationId: conversation.id,
    readState,
    unreadCount: 0,
  };
}

module.exports = {
  listConversations,
  listMessages,
  markConversationRead,
  reply,
  updateStatus,
  listSaleDrafts,
  getSaleDraft,
  createSaleDraft,
  updateSaleDraft,
  deleteSaleDraft,
  finalizeSaleDraft,
  listAssignableStaff,
  assignConversation,
  unassignConversation,
};