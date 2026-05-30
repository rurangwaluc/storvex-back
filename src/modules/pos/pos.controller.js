"use strict";

const prisma = require("../../config/database");
const {
  reserveSaleDocumentNumbersTx,
  reserveWarrantyDocumentNumberTx,
} = require("../documents/documentNumber.service");

// -----------------------------
// helpers
// -----------------------------
function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  const s = String(value || "").trim();
  return s || null;
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - Number(n || 0));
  return d;
}

function normalizeSaleType(value) {
  const v = String(value || "CASH").toUpperCase();
  return v === "CREDIT" ? "CREDIT" : "CASH";
}

function normalizePaymentMethod(value) {
  const v = String(value || "CASH").trim().toUpperCase();

  if (v === "CASH") return "CASH";
  if (v === "MOMO" || v === "MOBILE_MONEY" || v === "MTN_MOMO" || v === "AIRTEL_MONEY") {
    return "MOMO";
  }
  if (v === "CARD" || v === "VISA" || v === "MASTERCARD") return "CARD";
  if (v === "BANK" || v === "BANK_TRANSFER" || v === "TRANSFER") return "BANK";
  if (v === "OTHER") return "OTHER";

  return null;
}

function normalizeRefundMethod(value) {
  const v = String(value || "CASH").trim().toUpperCase();

  if (v === "CASH") return "CASH";
  if (v === "MOMO" || v === "MOBILE_MONEY" || v === "MTN_MOMO" || v === "AIRTEL_MONEY") {
    return "MOMO";
  }
  if (v === "CARD" || v === "VISA" || v === "MASTERCARD") return "CARD";
  if (v === "BANK" || v === "BANK_TRANSFER" || v === "TRANSFER") return "BANK";
  if (v === "OTHER") return "OTHER";

  return null;
}

function paymentMethodTouchesCashDrawer(method) {
  return String(method || "").toUpperCase() === "CASH";
}

function hasModelField(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

function roundMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function normalizeTaxMode(value) {
  const mode = String(value || "NONE").trim().toUpperCase();

  if (
    mode === "VAT_18" ||
    mode === "TURNOVER_3_INTERNAL" ||
    mode === "VAT_18_PLUS_TURNOVER_3" ||
    mode === "CUSTOM"
  ) {
    return mode;
  }

  return "NONE";
}

function normalizeTaxDisplayMode(value) {
  const mode = String(value || "HIDDEN").trim().toUpperCase();

  if (mode === "CUSTOMER_FACING" || mode === "INTERNAL_ONLY") {
    return mode;
  }

  return "HIDDEN";
}

function defaultTaxNameForMode(taxMode) {
  if (taxMode === "VAT_18") return "VAT 18% included";
  if (taxMode === "TURNOVER_3_INTERNAL") return "Turnover tax estimate included";
  if (taxMode === "VAT_18_PLUS_TURNOVER_3") return "Tax included";
  if (taxMode === "CUSTOM") return "Tax included";
  return null;
}

function includedTaxName(value, taxMode) {
  const base = normalizeText(value) || defaultTaxNameForMode(taxMode);
  if (!base) return null;

  if (String(base).toLowerCase().includes("included")) return base;

  return `${base} included`;
}

function defaultTaxRateBpsForMode(taxMode) {
  if (taxMode === "VAT_18") return 1800;
  if (taxMode === "TURNOVER_3_INTERNAL") return 300;
  if (taxMode === "VAT_18_PLUS_TURNOVER_3") return 2100;
  return 0;
}

function clampTaxRateBps(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(10000, Math.round(n)));
}

function normalizeTenantTaxSettings(settings = {}) {
  const taxMode = normalizeTaxMode(settings.taxMode);
  const taxDisplayMode = normalizeTaxDisplayMode(settings.taxDisplayMode);
  const defaultRate = defaultTaxRateBpsForMode(taxMode);
  const taxRateBps = clampTaxRateBps(settings.taxRateBps, defaultRate);

  // Retail rule: the product selling price is the final customer price.
  // VAT/tax is extracted from that price, not added on top at checkout.
  const pricesIncludeTax = taxMode !== "NONE" && taxRateBps > 0;

  const taxName =
    taxMode === "NONE"
      ? null
      : includedTaxName(settings.taxName, taxMode);

  const customerFacing =
    taxMode !== "NONE" &&
    taxRateBps > 0 &&
    taxDisplayMode === "CUSTOMER_FACING" &&
    Boolean(settings.showTaxOnCustomerDocuments);

  return {
    taxMode,
    taxDisplayMode,
    taxName,
    taxRateBps,
    pricesIncludeTax,
    showTaxOnCustomerDocuments: customerFacing,
  };
}

function calculateSaleTaxSnapshot(subtotal, settings = {}) {
  const safeSubtotal = roundMoney(subtotal);
  const taxSettings = normalizeTenantTaxSettings(settings);
  const hasTaxProfile = taxSettings.taxMode !== "NONE" && taxSettings.taxRateBps > 0;

  let taxableAmount = safeSubtotal;
  let taxAmount = 0;

  if (hasTaxProfile) {
    taxAmount = roundMoney(
      (safeSubtotal * taxSettings.taxRateBps) /
        (10000 + taxSettings.taxRateBps),
    );
    taxableAmount = Math.max(0, safeSubtotal - taxAmount);
  }

  const customerTaxIsCollected =
    taxSettings.showTaxOnCustomerDocuments &&
    taxSettings.taxDisplayMode === "CUSTOMER_FACING" &&
    hasTaxProfile;

  return {
    // Product selling price is gross/customer price.
    // For VAT-inclusive retail pricing, this remains equal to the final total.
    subtotalAmount: safeSubtotal,
    taxableAmount,
    taxName: hasTaxProfile ? taxSettings.taxName : null,
    taxMode: taxSettings.taxMode,
    taxDisplayMode: taxSettings.taxDisplayMode,
    taxRateBps: hasTaxProfile ? taxSettings.taxRateBps : 0,
    taxAmount: hasTaxProfile ? taxAmount : 0,
    pricesIncludeTax: hasTaxProfile,
    showTaxOnCustomerDocuments: customerTaxIsCollected,
    total: safeSubtotal,
  };
}

function saleTaxSnapshotSelect(db) {
  return {
    ...(hasModelField(db.sale, "subtotalAmount") ? { subtotalAmount: true } : {}),
    ...(hasModelField(db.sale, "taxableAmount") ? { taxableAmount: true } : {}),
    ...(hasModelField(db.sale, "taxName") ? { taxName: true } : {}),
    ...(hasModelField(db.sale, "taxMode") ? { taxMode: true } : {}),
    ...(hasModelField(db.sale, "taxDisplayMode") ? { taxDisplayMode: true } : {}),
    ...(hasModelField(db.sale, "taxRateBps") ? { taxRateBps: true } : {}),
    ...(hasModelField(db.sale, "taxAmount") ? { taxAmount: true } : {}),
    ...(hasModelField(db.sale, "pricesIncludeTax") ? { pricesIncludeTax: true } : {}),
    ...(hasModelField(db.sale, "showTaxOnCustomerDocuments")
      ? { showTaxOnCustomerDocuments: true }
      : {}),
  };
}

function saleTaxSnapshotData(db, taxSnapshot) {
  return {
    ...(hasModelField(db.sale, "subtotalAmount")
      ? { subtotalAmount: taxSnapshot.subtotalAmount }
      : {}),
    ...(hasModelField(db.sale, "taxableAmount")
      ? { taxableAmount: taxSnapshot.taxableAmount }
      : {}),
    ...(hasModelField(db.sale, "taxName") ? { taxName: taxSnapshot.taxName } : {}),
    ...(hasModelField(db.sale, "taxMode") ? { taxMode: taxSnapshot.taxMode } : {}),
    ...(hasModelField(db.sale, "taxDisplayMode")
      ? { taxDisplayMode: taxSnapshot.taxDisplayMode }
      : {}),
    ...(hasModelField(db.sale, "taxRateBps")
      ? { taxRateBps: taxSnapshot.taxRateBps }
      : {}),
    ...(hasModelField(db.sale, "taxAmount")
      ? { taxAmount: taxSnapshot.taxAmount }
      : {}),
    ...(hasModelField(db.sale, "pricesIncludeTax")
      ? { pricesIncludeTax: taxSnapshot.pricesIncludeTax }
      : {}),
    ...(hasModelField(db.sale, "showTaxOnCustomerDocuments")
      ? { showTaxOnCustomerDocuments: taxSnapshot.showTaxOnCustomerDocuments }
      : {}),
  };
}

function computeSaleStatus({ saleType, total, amountPaid, dueDate }) {
  const t = Number(total) || 0;
  const paid = Number(amountPaid) || 0;
  const balanceDue = Math.max(0, t - paid);

  if (saleType === "CASH") {
    return { status: "PAID", balanceDue: 0 };
  }

  const hasDue = dueDate && !Number.isNaN(new Date(dueDate).getTime());
  const isOverdue = hasDue && new Date(dueDate) < new Date();

  if (balanceDue <= 0) return { status: "PAID", balanceDue: 0 };
  if (paid > 0) return { status: isOverdue ? "OVERDUE" : "PARTIAL", balanceDue };

  return { status: isOverdue ? "OVERDUE" : "UNPAID", balanceDue };
}

function addMonthsUtc(date, months) {
  const d = new Date(date);
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + Number(months || 0),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

function addDaysUtc(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

function computeWarrantyEndDate(startsAt, durationMonths, durationDays) {
  let end = new Date(startsAt);
  if (Number(durationMonths || 0) > 0) {
    end = addMonthsUtc(end, Number(durationMonths || 0));
  }
  if (Number(durationDays || 0) > 0) {
    end = addDaysUtc(end, Number(durationDays || 0));
  }
  return end;
}

const SUPPORTED_AUDIT_ACTIONS = new Set([
  "CREATE_DEAL",
  "MARK_SOLD",
  "MARK_RETURNED",
  "MARK_PAID",
  "MARK_RECEIVED",
  "ADD_PAYMENT",
  "EXPENSE_CREATED",
  "EXPENSE_APPROVED",
  "EXPENSE_DELETED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DEACTIVATED",
  "PRODUCT_ACTIVATED",
]);

const SUPPORTED_AUDIT_ENTITIES = new Set([
  "INTERSTORE_DEAL",
  "EXPENSE",
  "SALE",
  "REPAIR",
  "PRODUCT",
  "CUSTOMER",
  "USER",
  "TENANT",
  "SUBSCRIPTION",
  "PAYMENT",
]);

async function writeAuditLog(db, { tenantId, userId, branchId, entity, action, entityId, metadata }) {
  try {
    if (!SUPPORTED_AUDIT_ACTIONS.has(String(action || ""))) {
      console.warn("writeAuditLog skipped: unsupported AuditAction", action);
      return;
    }

    if (!SUPPORTED_AUDIT_ENTITIES.has(String(entity || ""))) {
      console.warn("writeAuditLog skipped: unsupported AuditEntity", entity);
      return;
    }

    await db.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
        branchId: branchId || null,
        entity,
        action,
        entityId: entityId || null,
        metadata: metadata || null,
      },
    });
  } catch (err) {
    console.error("writeAuditLog error:", err);
  }
}

function saleDraftWhereFalse() {
  return typeof prisma.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {};
}

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function getActiveBranchId(req) {
  return (
    cleanString(req.user?.activeBranchId) ||
    cleanString(req.user?.branchId) ||
    cleanString(req.branchAccess?.activeBranchId) ||
    cleanString(req.branch?.id) ||
    null
  );
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function resolveReadBranchScope(req) {
  const requestedBranchId =
    cleanString(req.query?.branchId) ||
    cleanString(req.headers["x-branch-id"]) ||
    null;

  const allBranchesRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (allBranchesRequested) {
    if (!canViewAllBranches(req)) {
      const err = new Error("BRANCH_ACCESS_DENIED");
      err.status = 403;
      throw err;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (!canViewAllBranches(req) && !allowedBranchIds.includes(requestedBranchId)) {
      const err = new Error("BRANCH_ACCESS_DENIED");
      err.status = 403;
      throw err;
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      allowedBranchIds,
    };
  }

  return {
    mode: "SINGLE_BRANCH",
    branchId: getActiveBranchId(req),
    allowedBranchIds,
  };
}

function applyBranchScope(where, scope, key = "branchId") {
  const next = { ...(where || {}) };
  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    next[key] = scope.branchId;
  }
  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = req.user?.tenantId;
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    const err = new Error("BRANCH_REQUIRED");
    err.status = 400;
    throw err;
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(branchId)) {
    const err = new Error("BRANCH_ACCESS_DENIED");
    err.status = 403;
    throw err;
  }

  if (req.user?.canOperateInActiveBranch === false) {
    const err = new Error("BRANCH_OPERATION_DENIED");
    err.status = 403;
    throw err;
  }

  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      tenantId,
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
    },
  });

  if (!branch) {
    const err = new Error("BRANCH_NOT_FOUND");
    err.status = 404;
    throw err;
  }

  if (branch.status !== "ACTIVE") {
    const err = new Error("BRANCH_NOT_ACTIVE");
    err.status = 409;
    throw err;
  }

  return branch;
}

async function tryDecrementBranchInventoryTx(tx, { tenantId, branchId, productId, qty }) {
  if (!branchId || !tx.branchInventory || typeof tx.branchInventory.findFirst !== "function") {
    return { usedBranchInventory: false };
  }

  const existing = await tx.branchInventory.findFirst({
    where: {
      tenantId,
      branchId,
      productId,
    },
    select: {
      id: true,
      qtyOnHand: true,
    },
  });

  if (!existing) {
    return { usedBranchInventory: false };
  }

  const updated = await tx.branchInventory.updateMany({
    where: {
      tenantId,
      branchId,
      productId,
      qtyOnHand: { gte: qty },
    },
    data: {
      qtyOnHand: { decrement: qty },
    },
  });

  if (!updated || updated.count !== 1) {
    throw new Error(`INSUFFICIENT_BRANCH_STOCK:${productId}`);
  }

  return { usedBranchInventory: true };
}

async function tryIncrementBranchInventoryTx(tx, { tenantId, branchId, productId, qty }) {
  if (!branchId || !tx.branchInventory || typeof tx.branchInventory.findFirst !== "function") {
    return { usedBranchInventory: false };
  }

  const existing = await tx.branchInventory.findFirst({
    where: {
      tenantId,
      branchId,
      productId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    return { usedBranchInventory: false };
  }

  await tx.branchInventory.updateMany({
    where: {
      tenantId,
      branchId,
      productId,
    },
    data: {
      qtyOnHand: { increment: qty },
    },
  });

  return { usedBranchInventory: true };
}

async function resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer }) {
  if (customerId) {
    const existing = await tx.customer.findFirst({
      where: {
        id: String(customerId),
        tenantId,
        ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    return existing.id;
  }

  if (!customer) return null;

  const cleanName = normalizeText(customer.name);
  const cleanPhone = normalizePhone(customer.phone);
  const cleanEmail = normalizeText(customer.email);
  const cleanAddress = normalizeText(customer.address);
  const cleanTinNumber = normalizeText(customer.tinNumber);
  const cleanIdNumber = normalizeText(customer.idNumber);
  const cleanNotes = normalizeText(customer.notes);

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
      ...(typeof tx.customer.fields?.email !== "undefined" ? { email: true } : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" ? { address: true } : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
    },
  });

  if (existing) {
    const updateData = {
      ...(cleanName && cleanName !== existing.name ? { name: cleanName } : {}),
      ...(typeof tx.customer.fields?.email !== "undefined" && cleanEmail !== existing.email
        ? { email: cleanEmail }
        : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" && cleanAddress !== existing.address
        ? { address: cleanAddress }
        : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined" &&
      cleanTinNumber !== existing.tinNumber
        ? { tinNumber: cleanTinNumber }
        : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" &&
      cleanIdNumber !== existing.idNumber
        ? { idNumber: cleanIdNumber }
        : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" && cleanNotes !== existing.notes
        ? { notes: cleanNotes }
        : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" && existing.isActive === false
        ? { isActive: true }
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

  const created = await tx.customer.create({
    data: {
      tenantId,
      name: cleanName,
      phone: cleanPhone,
      ...(typeof tx.customer.fields?.email !== "undefined" ? { email: cleanEmail } : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" ? { address: cleanAddress } : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined"
        ? { tinNumber: cleanTinNumber }
        : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" ? { idNumber: cleanIdNumber } : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" ? { notes: cleanNotes } : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
    },
    select: { id: true },
  });

  return created.id;
}

async function resolveCustomerId(tx, tenantId, payload) {
  const { customerId, customer, customerName, customerPhone } = payload || {};

  if (customerId || customer) {
    return resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer });
  }

  if (customerName || customerPhone) {
    return resolveOrCreateCustomerTx(tx, tenantId, {
      customer: {
        name: customerName,
        phone: customerPhone,
      },
    });
  }

  return null;
}

async function getOpenCashSessionId(tx, tenantId, branchId) {
  if (!tenantId || !branchId) return null;

  const rows = await tx.$queryRaw`
    select id
    from public.cash_sessions
    where tenant_id::text = ${String(tenantId)}::text
      and branch_id::text = ${String(branchId)}::text
      and closed_at is null
    order by opened_at desc
    limit 1
  `;

  return rows?.[0]?.id || null;
}

async function insertCashMovementIfPossible(
  tx,
  { tenantId, branchId, userId, sessionId, type, reason, amount, note },
) {
  const amountBigInt = BigInt(Math.round(Number(amount || 0)));
  if (!sessionId || !branchId) return null;

  const rows = await tx.$queryRaw`
    insert into public.cash_movements
      (tenant_id, branch_id, session_id, type, reason, amount, note, created_by)
    values
      (
        ${String(tenantId)}::uuid,
        ${String(branchId)}::text,
        ${String(sessionId)}::uuid,
        ${String(type)}::cash_movement_type,
        ${String(reason)}::cash_movement_reason,
        ${amountBigInt},
        ${note},
        ${String(userId)}::uuid
      )
    returning id, tenant_id, branch_id, session_id, type, reason, amount, note, created_at, created_by
  `;

  return rows?.[0] || null;
}

async function getTenantCashDrawerPolicy(db, tenantId) {
  const rows = await db.$queryRaw`
    select cash_drawer_block_cash_sales
    from public."Tenant"
    where id::text = ${String(tenantId)}::text
    limit 1
  `;

  const blockCashSales = rows?.[0]?.cash_drawer_block_cash_sales;
  return blockCashSales == null ? true : Boolean(blockCashSales);
}

async function getTenantDocumentTaxSettings(db, tenantId) {
  if (!tenantId || !db.tenantDocumentSettings) {
    return normalizeTenantTaxSettings({});
  }

  const settings = await db.tenantDocumentSettings.upsert({
    where: { tenantId: String(tenantId) },
    update: {},
    create: {
      tenantId: String(tenantId),
      ...(hasModelField(db.tenantDocumentSettings, "documentHeaderDisplay")
        ? { documentHeaderDisplay: "LOGO_AND_NAME" }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "documentSizeMode")
        ? { documentSizeMode: "AUTO" }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxMode") ? { taxMode: "NONE" } : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxDisplayMode")
        ? { taxDisplayMode: "HIDDEN" }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxRateBps")
        ? { taxRateBps: 0 }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "pricesIncludeTax")
        ? { pricesIncludeTax: false }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "showTaxOnCustomerDocuments")
        ? { showTaxOnCustomerDocuments: false }
        : {}),
    },
    select: {
      ...(hasModelField(db.tenantDocumentSettings, "taxMode") ? { taxMode: true } : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxDisplayMode")
        ? { taxDisplayMode: true }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxName") ? { taxName: true } : {}),
      ...(hasModelField(db.tenantDocumentSettings, "taxRateBps")
        ? { taxRateBps: true }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "pricesIncludeTax")
        ? { pricesIncludeTax: true }
        : {}),
      ...(hasModelField(db.tenantDocumentSettings, "showTaxOnCustomerDocuments")
        ? { showTaxOnCustomerDocuments: true }
        : {}),
    },
  });

  return normalizeTenantTaxSettings(settings);
}

function toCashMovementDto(movement) {
  if (!movement) return null;

  return {
    id: movement.id,
    tenantId: movement.tenant_id,
    branchId: movement.branch_id,
    sessionId: movement.session_id,
    type: movement.type,
    reason: movement.reason,
    amount: String(movement.amount ?? 0),
    note: movement.note,
    createdAt: movement.created_at,
    createdBy: movement.created_by,
  };
}

// -----------------------------
// GET /api/pos/quick-picks
// -----------------------------
async function quickPicks(req, res) {
  try {
    const { tenantId } = req.user;
    const scope = resolveReadBranchScope(req);

    const periodDaysRaw = toInt(req.query.periodDays, 7);
    const limitRaw = toInt(req.query.limit, 10);

    const periodDays =
      Number.isFinite(periodDaysRaw) && periodDaysRaw > 0 && periodDaysRaw <= 90
        ? periodDaysRaw
        : 7;

    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 10;

    const since = daysAgo(periodDays);

    const grouped = await prisma.saleItem.groupBy({
      by: ["productId"],
      where: {
        sale: applyBranchScope(
          {
            tenantId,
            createdAt: { gte: since },
            isCancelled: false,
            ...saleDraftWhereFalse(),
          },
          scope,
        ),
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });

    const productIds = grouped.map((g) => g.productId);
    let bestSellers = [];

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: {
          tenantId,
          isActive: true,
          id: { in: productIds },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          serial: true,
          sellPrice: true,
          stockQty: true,
        },
      });

      const byId = new Map(products.map((p) => [p.id, p]));

      bestSellers = grouped
        .map((g) => {
          const p = byId.get(g.productId);
          if (!p) return null;
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            serial: p.serial,
            sellPrice: p.sellPrice,
            stockQty: p.stockQty,
            soldQty: Number(g._sum.quantity || 0),
          };
        })
        .filter(Boolean);
    }

    const latest = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        serial: true,
        sellPrice: true,
        stockQty: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.json({
      periodDays,
      limit,
      branchScope: scope,
      bestSellers,
      latest,
    });
  } catch (err) {
    if (String(err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("quickPicks error:", err);
    return res.status(500).json({ message: "Failed to load quick picks" });
  }
}

// -----------------------------
// POST /api/pos/sales
// -----------------------------
async function createSale(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const activeBranch = await ensureWritableBranchAccessOrThrow(req);
    const branchId = activeBranch.id;

    const {
      items,
      customerId,
      customer,
      customerName,
      customerPhone,
      saleType,
      amountPaid,
      dueDate,
      paymentMethod,
      method,
      paymentReference,
    } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Sale items are required" });
    }

    for (const item of items) {
      if (!item?.productId) {
        return res.status(400).json({ message: "Each item must have a product selected" });
      }

      const q = toInt(item.quantity, NaN);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ message: "Quantity must be a positive number" });
      }
    }

    const finalSaleType = normalizeSaleType(saleType);
    const selectedPaymentMethod = normalizePaymentMethod(paymentMethod || method || "CASH");

    if (!selectedPaymentMethod) {
      return res.status(400).json({
        message: "Payment method must be one of CASH, MOMO, CARD, BANK, OTHER",
        code: "INVALID_PAYMENT_METHOD",
      });
    }

    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    if (dueDate && Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ message: "Invalid due date" });
    }

    if (finalSaleType === "CREDIT" && !parsedDueDate) {
      return res.status(400).json({ message: "Due date is required for credit sale" });
    }

    const paidRequested = Math.max(0, toNumber(amountPaid, 0));

    const shouldBlock = await getTenantCashDrawerPolicy(prisma, tenantId);
    const cashTouchesDrawer =
      finalSaleType === "CASH"
        ? paymentMethodTouchesCashDrawer(selectedPaymentMethod)
        : paymentMethodTouchesCashDrawer(selectedPaymentMethod) && paidRequested > 0;

    if (shouldBlock && cashTouchesDrawer) {
      const openSessionId = await getOpenCashSessionId(prisma, tenantId, branchId);

      if (!openSessionId) {
        return res.status(409).json({
          message:
            "Cash drawer is closed for this selling location. Open the drawer before recording cash.",
          code: "CASH_DRAWER_CLOSED",
        });
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const resolvedCustomerId = await resolveCustomerId(tx, tenantId, {
          customerId,
          customer,
          customerName,
          customerPhone,
        });

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
          },
        });

        const byId = new Map(products.map((p) => [p.id, p]));

        for (const item of items) {
          const pid = String(item.productId);
          if (!byId.has(pid)) {
            throw new Error(`PRODUCT_NOT_FOUND:${pid}`);
          }
        }

        for (const item of items) {
          const pid = String(item.productId);
          const qty = toInt(item.quantity);

          await tryDecrementBranchInventoryTx(tx, {
            tenantId,
            branchId,
            productId: pid,
            qty,
          });

          const updated = await tx.product.updateMany({
            where: {
              id: pid,
              tenantId,
              isActive: true,
              stockQty: { gte: qty },
            },
            data: {
              stockQty: { decrement: qty },
            },
          });

          if (!updated || updated.count !== 1) {
            const p = byId.get(pid);
            throw new Error(`INSUFFICIENT_STOCK:${p?.name || pid}`);
          }
        }

        let subtotal = 0;
        const itemRows = [];

        for (const item of items) {
          const pid = String(item.productId);
          const qty = toInt(item.quantity);
          const p = byId.get(pid);
          const price = Number(p.sellPrice || 0);

          subtotal += price * qty;

          itemRows.push({
            productId: pid,
            quantity: qty,
            price,
          });
        }

        const tenantTaxSettings = await getTenantDocumentTaxSettings(tx, tenantId);
        const taxSnapshot = calculateSaleTaxSnapshot(subtotal, tenantTaxSettings);
        const total = taxSnapshot.total;

        const initialPaid = finalSaleType === "CASH" ? total : Math.min(paidRequested, total);

        if (finalSaleType === "CREDIT" && initialPaid > total + 0.000001) {
          throw new Error("AMOUNT_PAID_TOO_HIGH");
        }

        const { status, balanceDue } = computeSaleStatus({
          saleType: finalSaleType,
          total,
          amountPaid: initialPaid,
          dueDate: parsedDueDate,
        });

        const saleCreatedAt = new Date();

        const documentNumbers = await reserveSaleDocumentNumbersTx(tx, {
          tenantId,
          createdAt: saleCreatedAt,
        });

        const sale = await tx.sale.create({
          data: {
            tenantId,
            branchId,
            cashierId: userId,
            customerId: resolvedCustomerId,
            total,
            ...saleTaxSnapshotData(tx, taxSnapshot),
            saleType: finalSaleType,
            amountPaid: initialPaid,
            balanceDue,
            status,
            dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
            receiptNumber: documentNumbers.receiptNumber,
            invoiceNumber: documentNumbers.invoiceNumber,
            createdAt: saleCreatedAt,
            ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {}),
          },
          select: {
            id: true,
            tenantId: true,
            branchId: true,
            cashierId: true,
            customerId: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            saleType: true,
            status: true,
            amountPaid: true,
            balanceDue: true,
            dueDate: true,
            createdAt: true,
            receiptNumber: true,
            invoiceNumber: true,
            ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: true } : {}),
          },
        });

        const createdItems = [];

        for (const row of itemRows) {
          const it = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: row.productId,
              quantity: row.quantity,
              price: row.price,
            },
            select: {
              id: true,
              saleId: true,
              productId: true,
              quantity: true,
              price: true,
            },
          });

          createdItems.push(it);
        }

        const openSessionId = await getOpenCashSessionId(tx, tenantId, branchId);

        let cashMovement = null;
        let payment = null;
        let depositMovement = null;

        if (finalSaleType === "CASH") {
          const paymentNoteParts = [
            "Paid sale",
            sale.receiptNumber || sale.id,
            selectedPaymentMethod,
          ];

          const ref = normalizeText(paymentReference);
          if (ref) paymentNoteParts.push(ref);

          payment = await tx.salePayment.create({
            data: {
              saleId: sale.id,
              tenantId,
              branchId,
              receivedById: userId,
              amount: total,
              method: selectedPaymentMethod,
              note: `${paymentNoteParts.join(" • ")} • ${Date.now()}`,
            },
            select: {
              id: true,
              amount: true,
              method: true,
              createdAt: true,
              note: true,
              branchId: true,
            },
          });

          if (paymentMethodTouchesCashDrawer(selectedPaymentMethod)) {
            cashMovement = await insertCashMovementIfPossible(tx, {
              tenantId,
              branchId,
              userId,
              sessionId: openSessionId,
              type: "IN",
              reason: "OTHER",
              amount: total,
              note: `Cash sale ${sale.receiptNumber || sale.id}`,
            });
          }
        }

        if (finalSaleType === "CREDIT" && initialPaid > 0) {
          const paymentNoteParts = [
            "Initial payment",
            sale.receiptNumber || sale.id,
            selectedPaymentMethod,
          ];

          const ref = normalizeText(paymentReference);
          if (ref) paymentNoteParts.push(ref);

          payment = await tx.salePayment.create({
            data: {
              saleId: sale.id,
              tenantId,
              branchId,
              receivedById: userId,
              amount: initialPaid,
              method: selectedPaymentMethod,
              note: `${paymentNoteParts.join(" • ")} • ${Date.now()}`,
            },
            select: {
              id: true,
              amount: true,
              method: true,
              createdAt: true,
              note: true,
              branchId: true,
            },
          });

          if (paymentMethodTouchesCashDrawer(selectedPaymentMethod)) {
            depositMovement = await insertCashMovementIfPossible(tx, {
              tenantId,
              branchId,
              userId,
              sessionId: openSessionId,
              type: "IN",
              reason: "DEPOSIT",
              amount: initialPaid,
              note: `Credit deposit ${sale.receiptNumber || sale.id}`,
            });
          }
        }

        return {
          sale,
          items: createdItems,
          payment,
          cashMovement,
          depositMovement,
          auditMeta: {
            sellingLocation: activeBranch.name || activeBranch.code || null,
            branchId,
            saleType: finalSaleType,
            paymentMethod: selectedPaymentMethod,
            subtotalAmount: taxSnapshot.subtotalAmount,
            taxableAmount: taxSnapshot.taxableAmount,
            taxName: taxSnapshot.taxName,
            taxMode: taxSnapshot.taxMode,
            taxDisplayMode: taxSnapshot.taxDisplayMode,
            taxRateBps: taxSnapshot.taxRateBps,
            taxAmount: taxSnapshot.taxAmount,
            pricesIncludeTax: taxSnapshot.pricesIncludeTax,
            showTaxOnCustomerDocuments: taxSnapshot.showTaxOnCustomerDocuments,
            total,
            amountPaid: initialPaid,
            balanceDue,
            itemCount: createdItems.length,
            receiptNumber: sale.receiptNumber,
            invoiceNumber: sale.invoiceNumber,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      branchId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: result.sale.id,
      metadata: {
        event: "SALE_CREATED",
        ...result.auditMeta,
      },
    });

    return res.status(201).json({
      created: true,
      sale: result.sale,
      items: result.items,
      payment: result.payment,
      cashMovement: toCashMovementDto(result.cashMovement),
      depositMovement: toCashMovementDto(result.depositMovement),
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (msg === "BRANCH_REQUIRED") {
      return res.status(400).json({
        message: "Choose a selling location before recording this sale.",
        code: "BRANCH_REQUIRED",
      });
    }

    if (msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({
        message: "You do not have access to this selling location.",
        code: "BRANCH_ACCESS_DENIED",
      });
    }

    if (msg === "BRANCH_OPERATION_DENIED") {
      return res.status(403).json({
        message: "You cannot record sales from this selling location.",
        code: "BRANCH_OPERATION_DENIED",
      });
    }

    if (msg === "BRANCH_NOT_FOUND") {
      return res.status(404).json({
        message: "Selling location was not found.",
      });
    }

    if (msg === "BRANCH_NOT_ACTIVE") {
      return res.status(409).json({
        message: "Selected selling location is not active.",
      });
    }

    if (msg === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({
        message: "Customer name and customer phone are required when saving a new customer.",
      });
    }

    if (msg === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (msg.startsWith("PRODUCT_NOT_FOUND:")) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (msg.startsWith("INSUFFICIENT_BRANCH_STOCK:")) {
      return res.status(400).json({
        message: "Not enough stock available in this selling location.",
      });
    }

    if (msg.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(400).json({
        message: msg.replace("INSUFFICIENT_STOCK:", "Insufficient stock for "),
      });
    }

    if (msg === "AMOUNT_PAID_TOO_HIGH") {
      return res.status(400).json({
        message: "Amount paid cannot exceed sale total.",
      });
    }

    console.error("createSale error:", err);
    return res.status(500).json({ message: "Failed to create sale" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/warranty
// -----------------------------
async function createSaleWarranty(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const branchScope = resolveReadBranchScope(req);
    const saleId = String(req.params.id || "").trim();

    const { policy, durationMonths, durationDays, startsAt, units } = req.body || {};

    if (!saleId) {
      return res.status(400).json({ message: "Missing sale id" });
    }

    if (!Array.isArray(units) || units.length === 0) {
      return res.status(400).json({ message: "Warranty units are required" });
    }

    const parsedDurationMonths = Math.max(0, toInt(durationMonths, 0));
    const parsedDurationDays = Math.max(0, toInt(durationDays, 0));

    if (parsedDurationMonths === 0 && parsedDurationDays === 0) {
      return res.status(400).json({
        message: "durationMonths or durationDays must be greater than zero",
      });
    }

    const parsedStartsAt = startsAt ? new Date(startsAt) : new Date();
    if (Number.isNaN(parsedStartsAt.getTime())) {
      return res.status(400).json({ message: "Invalid startsAt" });
    }

    for (const unit of units) {
      if (!unit?.saleItemId) {
        return res.status(400).json({ message: "Each warranty unit must have saleItemId" });
      }
      if (!unit?.productId) {
        return res.status(400).json({ message: "Each warranty unit must have productId" });
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: applyBranchScope(
            { id: saleId, tenantId, ...saleDraftWhereFalse() },
            branchScope,
          ),
          select: {
            id: true,
            tenantId: true,
            branchId: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                product: {
                  select: {
                    name: true,
                    sku: true,
                    barcode: true,
                  },
                },
              },
            },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        const saleItemsById = new Map(sale.items.map((it) => [String(it.id), it]));

        for (const unit of units) {
          const saleItemId = String(unit.saleItemId);
          const productId = String(unit.productId);
          const saleItem = saleItemsById.get(saleItemId);

          if (!saleItem) {
            const e = new Error(`SALE_ITEM_NOT_FOUND:${saleItemId}`);
            e.code = "SALE_ITEM_NOT_FOUND";
            throw e;
          }

          if (String(saleItem.productId) !== productId) {
            const e = new Error(`SALE_ITEM_PRODUCT_MISMATCH:${saleItemId}`);
            e.code = "SALE_ITEM_PRODUCT_MISMATCH";
            throw e;
          }
        }

        const endsAt = computeWarrantyEndDate(
          parsedStartsAt,
          parsedDurationMonths,
          parsedDurationDays,
        );

        const doc = await reserveWarrantyDocumentNumberTx(tx, {
          tenantId,
          createdAt: parsedStartsAt,
        });

        const warranty = await tx.saleWarranty.create({
          data: {
            saleId: sale.id,
            tenantId,
            branchId: sale.branchId || null,
            createdById: userId,
            policy: normalizeText(policy),
            durationMonths: parsedDurationMonths || null,
            durationDays: parsedDurationDays || null,
            startsAt: parsedStartsAt,
            endsAt,
            warrantyNumber: doc.warrantyNumber,
          },
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            branchId: true,
            policy: true,
            durationMonths: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            warrantyNumber: true,
          },
        });

        const createdUnits = [];
        for (const unit of units) {
          const saleItem = saleItemsById.get(String(unit.saleItemId));

          const createdUnit = await tx.saleWarrantyUnit.create({
            data: {
              warrantyId: warranty.id,
              saleItemId: String(unit.saleItemId),
              productId: String(unit.productId),
              serial: normalizeText(unit.serial),
              imei1: normalizeText(unit.imei1),
              imei2: normalizeText(unit.imei2),
              unitLabel: normalizeText(unit.unitLabel),
              startsAt: parsedStartsAt,
              endsAt,
            },
            select: {
              id: true,
              saleItemId: true,
              productId: true,
              serial: true,
              imei1: true,
              imei2: true,
              unitLabel: true,
              startsAt: true,
              endsAt: true,
              createdAt: true,
            },
          });

          createdUnits.push({
            ...createdUnit,
            productName: saleItem?.product?.name || null,
            sku: saleItem?.product?.sku || null,
            barcode: saleItem?.product?.barcode || null,
          });
        }

        return {
          saleBranchId: sale.branchId || null,
          warranty: {
            ...warranty,
            units: createdUnits,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      branchId: result.saleBranchId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "WARRANTY_CREATED",
        warrantyId: result.warranty.id,
        warrantyNumber: result.warranty.warrantyNumber,
        unitsCount: result.warranty.units.length,
      },
    });

    return res.status(201).json({
      message: "Warranty created",
      warranty: result.warranty,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (msg.startsWith("SALE_ITEM_NOT_FOUND:")) {
      return res.status(400).json({ message: "A sale item was not found for this sale" });
    }

    if (msg.startsWith("SALE_ITEM_PRODUCT_MISMATCH:")) {
      return res.status(400).json({ message: "saleItemId and productId do not match" });
    }

    console.error("createSaleWarranty error:", err);
    return res.status(500).json({ message: "Failed to create warranty" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/payments
// -----------------------------
async function addSalePayment(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const branchScope = resolveReadBranchScope(req);
    const saleId = String(req.params.id || "");
    const { amount, method, paymentMethod, paymentReference, note } = req.body || {};

    const payAmount = toNumber(amount, NaN);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const payMethod = normalizePaymentMethod(method || paymentMethod || "CASH");

    if (!payMethod) {
      return res.status(400).json({
        message: "method must be one of CASH, MOMO, CARD, BANK, OTHER",
        code: "INVALID_PAYMENT_METHOD",
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: applyBranchScope(
            { id: saleId, tenantId, ...saleDraftWhereFalse() },
            branchScope,
          ),
          select: {
            id: true,
            branchId: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            amountPaid: true,
            balanceDue: true,
            dueDate: true,
            saleType: true,
            isCancelled: true,
          },
        });

        if (!sale) throw new Error("SALE_NOT_FOUND");
        if (sale.isCancelled) throw new Error("SALE_CANCELLED");
        if (sale.saleType !== "CREDIT") throw new Error("NOT_CREDIT_SALE");

        const newPaid = Number(sale.amountPaid) + payAmount;
        if (newPaid > Number(sale.total) + 0.000001) throw new Error("PAYMENT_TOO_BIG");

        const { status, balanceDue } = computeSaleStatus({
          saleType: "CREDIT",
          total: sale.total,
          amountPaid: newPaid,
          dueDate: sale.dueDate,
        });

        const base = String(note || "").trim();
        const ref = normalizeText(paymentReference);
        const safeNote = [
          base || "Payment",
          sale.id,
          payMethod,
          ref,
          Date.now(),
        ]
          .filter(Boolean)
          .join(" • ");

        const payment = await tx.salePayment.create({
          data: {
            saleId: sale.id,
            tenantId,
            branchId: sale.branchId || null,
            receivedById: userId,
            amount: payAmount,
            method: payMethod,
            note: safeNote,
          },
          select: {
            id: true,
            amount: true,
            method: true,
            createdAt: true,
            note: true,
            branchId: true,
          },
        });

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            amountPaid: newPaid,
            balanceDue,
            status,
          },
          select: {
            id: true,
            branchId: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            amountPaid: true,
            balanceDue: true,
            status: true,
            dueDate: true,
          },
        });

        let movement = null;

        if (paymentMethodTouchesCashDrawer(payMethod)) {
          const openSessionId = await getOpenCashSessionId(tx, tenantId, sale.branchId);
          const shouldBlock = await getTenantCashDrawerPolicy(tx, tenantId);

          if (shouldBlock && !openSessionId) {
            throw new Error("CASH_DRAWER_CLOSED_FOR_BRANCH");
          }

          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            branchId: sale.branchId || null,
            userId,
            sessionId: openSessionId,
            type: "IN",
            reason: "DEPOSIT",
            amount: payAmount,
            note: `Credit payment for sale ${sale.id} (${sale.branchId || "no-branch"})`,
          });
        }

        return {
          payment,
          sale: updatedSale,
          movement,
          auditMeta: {
            branchId: sale.branchId || null,
            amount: payAmount,
            method: payMethod,
            note: safeNote,
            balanceDueBefore: Number(sale.balanceDue || 0),
            balanceDueAfter: Number(updatedSale.balanceDue || 0),
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      branchId: result.auditMeta.branchId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: result.auditMeta,
    });

    return res.status(201).json({
      message: "Payment recorded",
      sale: result.sale,
      payment: result.payment,
      cashMovement: toCashMovementDto(result.movement),
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }
    if (msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }
    if (msg === "SALE_CANCELLED") {
      return res.status(400).json({ message: "Cannot add payment to cancelled sale" });
    }
    if (msg === "NOT_CREDIT_SALE") {
      return res.status(400).json({ message: "Payments can only be added to CREDIT sales" });
    }
    if (msg === "PAYMENT_TOO_BIG") {
      return res.status(400).json({ message: "Payment exceeds remaining balance" });
    }
    if (msg === "CASH_DRAWER_CLOSED_FOR_BRANCH") {
      return res.status(409).json({
        message: "Cash drawer is closed for this sale branch",
        code: "CASH_DRAWER_CLOSED",
      });
    }

    console.error("addSalePayment error:", err);
    return res.status(500).json({ message: "Failed to record payment" });
  }
}

// -----------------------------
// GET /api/pos/sales
// -----------------------------
async function listSales(req, res) {
  try {
    const { tenantId } = req.user;
    const scope = resolveReadBranchScope(req);

    const sales = await prisma.sale.findMany({
      where: applyBranchScope({ tenantId, ...saleDraftWhereFalse() }, scope),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        total: true,
        ...saleTaxSnapshotSelect(prisma),
        saleType: true,
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        isCancelled: true,
        cancelledAt: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        ...(typeof prisma.sale.fields?.isDraft !== "undefined" ? { isDraft: true } : {}),
        cashier: { select: { name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
        payments: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            amount: true,
            method: true,
            note: true,
            createdAt: true,
            branchId: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
          },
        },
      },
    });

    return res.json({ sales, branchScope: scope });
  } catch (err) {
    if (String(err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listSales error:", err);
    return res.status(500).json({ message: "Failed to fetch sales" });
  }
}


async function getReceiptStoreProfile(tenantId, branch) {
  if (!tenantId) return null;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      shopType: true,
      district: true,
      sector: true,
      address: true,
      countryCode: true,
      currencyCode: true,
      timezone: true,
      logoUrl: true,
      logoKey: true,
      receiptHeader: true,
      receiptFooter: true,
    },
  });

  if (!tenant) return null;

  const branchCode = branch?.code || null;
  const branchName = branch?.name || null;

  const locationParts = [
    tenant.sector,
    tenant.district,
    tenant.address,
  ].filter(Boolean);

  return {
    id: tenant.id,

    // Business identity from Store settings
    name: tenant.name || "Store",
    email: tenant.email || null,
    phone: tenant.phone || null,
    shopType: tenant.shopType || null,
    district: tenant.district || null,
    sector: tenant.sector || null,
    address: tenant.address || null,
    countryCode: tenant.countryCode || "RW",
    currencyCode: tenant.currencyCode || "RWF",
    timezone: tenant.timezone || "Africa/Kigali",

    // This is the real uploaded business logo from SettingsGeneral.jsx
    logoUrl: tenant.logoUrl || null,
    logoKey: tenant.logoKey || null,

    // Receipt copy from Store settings
    receiptHeader: tenant.receiptHeader || null,
    receiptFooter: tenant.receiptFooter || null,

    // Branch identity for the receipt UI
    branchId: branch?.id || null,
    branchCode,
    branchName,
    branchStatus: branch?.status || null,
    branchIsMain: Boolean(branch?.isMain),
    branchLocation: locationParts.join(" • ") || null,
  };
}

// -----------------------------
// GET /api/pos/sales/:id
// GET /api/pos/sales/:id/receipt
// -----------------------------
async function getSaleReceipt(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const scope = resolveReadBranchScope(req);
    const saleId = String(req.params.id || "").trim();

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!saleId) {
      return res.status(400).json({ message: "Missing sale id" });
    }

    const sale = await prisma.sale.findFirst({
      where: applyBranchScope(
        {
          id: saleId,
          tenantId,
        },
        scope,
      ),
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        cashierId: true,
        customerId: true,

        total: true,
        ...saleTaxSnapshotSelect(prisma),
        createdAt: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        saleType: true,
        status: true,

        isDraft: true,
        draftSource: true,
        finalizedAt: true,

        isCancelled: true,
        cancelledAt: true,
        cancelledById: true,
        cancelNote: true,

        refundedTotal: true,
        receiptNumber: true,
        invoiceNumber: true,

        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },

        cashier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },

        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
            ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
          },
        },

        items: {
          orderBy: [{ id: "asc" }],
          select: {
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
                barcode: true,
                ...(typeof prisma.product.fields?.serial !== "undefined" ? { serial: true } : {}),
              },
            },
          },
        },

        payments: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            branchId: true,
            receivedById: true,
            amount: true,
            method: true,
            note: true,
            createdAt: true,
          },
        },

        refunds: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            branchId: true,
            createdById: true,
            total: true,
            method: true,
            note: true,
            reason: true,
            createdAt: true,
          },
        },

        warranties: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            branchId: true,
            createdById: true,
            policy: true,
            durationMonths: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            warrantyNumber: true,
            units: {
              orderBy: [{ createdAt: "asc" }],
              select: {
                id: true,
                warrantyId: true,
                saleItemId: true,
                productId: true,
                serial: true,
                imei1: true,
                imei2: true,
                unitLabel: true,
                startsAt: true,
                endsAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const store = await getReceiptStoreProfile(tenantId, sale.branch);

    return res.json({
      sale,

      // Top-level store object for frontend receipt UI.
      // This is where PosReceipt.jsx reads store.logoUrl.
      store,

      // Keep branch top-level too, so receipt/document pages do not need to dig into sale.branch.
      branch: sale.branch || null,

      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("getSaleReceipt error:", err);
    return res.status(500).json({ message: "Failed to load sale" });
  }
}

// -----------------------------
// GET /api/pos/credit/outstanding
// -----------------------------
async function listOutstandingCredit(req, res) {
  try {
    const { tenantId } = req.user;
    const scope = resolveReadBranchScope(req);

    const sales = await prisma.sale.findMany({
      where: applyBranchScope(
        {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          isCancelled: false,
          ...saleDraftWhereFalse(),
        },
        scope,
      ),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        branchId: true,
        total: true,
        ...saleTaxSnapshotSelect(prisma),
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
          },
        },
      },
    });

    return res.json({ sales, branchScope: scope });
  } catch (err) {
    if (String(err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listOutstandingCredit error:", err);
    return res.status(500).json({ message: "Failed to fetch outstanding credit" });
  }
}

// -----------------------------
// GET /api/pos/credit/overdue
// -----------------------------
async function listOverdueCredit(req, res) {
  try {
    const { tenantId } = req.user;
    const scope = resolveReadBranchScope(req);

    const now = new Date();
    const sales = await prisma.sale.findMany({
      where: applyBranchScope(
        {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          dueDate: { lt: now },
          isCancelled: false,
          ...saleDraftWhereFalse(),
        },
        scope,
      ),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        branchId: true,
        total: true,
        ...saleTaxSnapshotSelect(prisma),
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
          },
        },
      },
    });

    return res.json({ sales, branchScope: scope });
  } catch (err) {
    if (String(err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listOverdueCredit error:", err);
    return res.status(500).json({ message: "Failed to fetch overdue credit" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/cancel
// -----------------------------
async function cancelSale(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const scope = resolveReadBranchScope(req);
    const saleId = String(req.params.id || "").trim();
    const { note } = req.body || {};

    if (!saleId) return res.status(400).json({ message: "Missing sale id" });

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: applyBranchScope(
            { id: saleId, tenantId, ...saleDraftWhereFalse() },
            scope,
          ),
          select: {
            id: true,
            tenantId: true,
            branchId: true,
            saleType: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            amountPaid: true,
            isCancelled: true,
            refundedTotal: true,
            items: {
              select: {
                productId: true,
                quantity: true,
              },
            },
            refunds: { select: { id: true }, take: 1 },
            payments: { select: { id: true, method: true }, take: 5 },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        if (sale.isCancelled) {
          const e = new Error("ALREADY_CANCELLED");
          e.code = "ALREADY_CANCELLED";
          throw e;
        }

        if ((sale.refunds?.length || 0) > 0 || Number(sale.refundedTotal || 0) > 0) {
          const e = new Error("HAS_REFUNDS");
          e.code = "HAS_REFUNDS";
          throw e;
        }

        if (sale.saleType === "CREDIT") {
          const paid = Number(sale.amountPaid || 0);
          if (paid > 0 || (sale.payments?.length || 0) > 0) {
            const e = new Error("CREDIT_HAS_PAYMENTS");
            e.code = "CREDIT_HAS_PAYMENTS";
            throw e;
          }
        }

        for (const it of sale.items) {
          await tryIncrementBranchInventoryTx(tx, {
            tenantId,
            branchId: sale.branchId || null,
            productId: it.productId,
            qty: it.quantity,
          });

          const updated = await tx.product.updateMany({
            where: { id: it.productId, tenantId, isActive: true },
            data: { stockQty: { increment: it.quantity } },
          });

          if (!updated || updated.count !== 1) {
            const e = new Error(`PRODUCT_NOT_FOUND:${it.productId}`);
            e.code = "PRODUCT_NOT_FOUND";
            throw e;
          }
        }

        const cleanNote = normalizeText(note);

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            isCancelled: true,
            cancelledAt: new Date(),
            cancelledById: userId,
            cancelNote: cleanNote,
          },
          select: {
            id: true,
            branchId: true,
            saleType: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            isCancelled: true,
            cancelledAt: true,
            cancelledById: true,
            cancelNote: true,
          },
        });

        let movement = null;
        const cashWasReceived = (sale.payments || []).some((payment) =>
          paymentMethodTouchesCashDrawer(payment.method),
        );

        if (sale.saleType === "CASH" && cashWasReceived) {
          const openSessionId = await getOpenCashSessionId(tx, tenantId, sale.branchId);
          const shouldBlock = await getTenantCashDrawerPolicy(tx, tenantId);

          if (shouldBlock && !openSessionId) {
            throw new Error("CASH_DRAWER_CLOSED_FOR_BRANCH");
          }

          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            branchId: sale.branchId || null,
            userId,
            sessionId: openSessionId,
            type: "OUT",
            reason: "WITHDRAWAL",
            amount: sale.total,
            note: `Cancel sale ${sale.id} (${sale.branchId || "no-branch"})`,
          });
        }

        return {
          sale: updatedSale,
          movement,
          auditMeta: {
            branchId: sale.branchId || null,
            note: cleanNote,
            saleType: sale.saleType,
            total: Number(sale.total || 0),
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      branchId: result.auditMeta.branchId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "SALE_CANCELLED",
        ...result.auditMeta,
      },
    });

    return res.json({
      message: "Sale cancelled",
      sale: result.sale,
      cashMovement: toCashMovementDto(result.movement),
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }
    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (code === "ALREADY_CANCELLED" || msg === "ALREADY_CANCELLED") {
      return res.status(400).json({ message: "Sale already cancelled" });
    }

    if (code === "HAS_REFUNDS" || msg === "HAS_REFUNDS") {
      return res.status(400).json({ message: "Cannot cancel a sale that has refunds" });
    }

    if (code === "CREDIT_HAS_PAYMENTS" || msg === "CREDIT_HAS_PAYMENTS") {
      return res.status(400).json({ message: "Cannot cancel CREDIT sale that has payments" });
    }

    if (msg.startsWith("PRODUCT_NOT_FOUND:")) {
      return res.status(400).json({ message: "A product on this sale no longer exists" });
    }

    if (msg === "CASH_DRAWER_CLOSED_FOR_BRANCH") {
      return res.status(409).json({
        message: "Cash drawer is closed for this sale branch",
        code: "CASH_DRAWER_CLOSED",
      });
    }

    console.error("cancelSale error:", err);
    return res.status(500).json({ message: "Failed to cancel sale" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/refunds
// -----------------------------
async function createSaleRefund(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const scope = resolveReadBranchScope(req);
    const saleId = String(req.params.id || "").trim();
    const { items, method, paymentMethod, note, reason } = req.body || {};

    if (!saleId) return res.status(400).json({ message: "Missing sale id" });

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Refund items are required" });
    }

    for (const it of items) {
      if (!it?.productId) {
        return res.status(400).json({ message: "Each refund item must have productId" });
      }
      const q = Number(it.quantity);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ message: "quantity must be a positive integer" });
      }
    }

    const refundMethod = normalizeRefundMethod(method || paymentMethod || "CASH");

    if (!refundMethod) {
      return res.status(400).json({
        message: "method must be one of CASH, MOMO, CARD, BANK, OTHER",
        code: "INVALID_REFUND_METHOD",
      });
    }

    const cleanReason = normalizeText(reason);
    const cleanNote = normalizeText(note);

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: applyBranchScope(
            { id: saleId, tenantId, ...saleDraftWhereFalse() },
            scope,
          ),
          select: {
            id: true,
            tenantId: true,
            branchId: true,
            saleType: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            amountPaid: true,
            refundedTotal: true,
            isCancelled: true,
            items: {
              select: { productId: true, quantity: true, price: true },
            },
            refunds: {
              select: {
                id: true,
                items: { select: { productId: true, quantity: true } },
              },
            },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        if (sale.isCancelled) {
          const e = new Error("SALE_CANCELLED");
          e.code = "SALE_CANCELLED";
          throw e;
        }

        const soldQty = new Map();
        const priceByProduct = new Map();

        for (const it of sale.items) {
          const pid = String(it.productId);
          soldQty.set(pid, (soldQty.get(pid) || 0) + Number(it.quantity || 0));
          priceByProduct.set(pid, Number(it.price || 0));
        }

        const refundedQty = new Map();
        for (const r of sale.refunds || []) {
          for (const it of r.items || []) {
            const pid = String(it.productId);
            refundedQty.set(pid, (refundedQty.get(pid) || 0) + Number(it.quantity || 0));
          }
        }

        for (const reqIt of items) {
          const pid = String(reqIt.productId);
          const q = Number(reqIt.quantity);
          const sold = soldQty.get(pid) || 0;
          const already = refundedQty.get(pid) || 0;
          const remaining = sold - already;

          if (sold <= 0) {
            const e = new Error(`NOT_IN_SALE:${pid}`);
            e.code = "NOT_IN_SALE";
            throw e;
          }
          if (q > remaining) {
            const e = new Error(`REFUND_TOO_MUCH:${pid}`);
            e.code = "REFUND_TOO_MUCH";
            throw e;
          }
        }

        let refundTotal = 0;
        const refundItemRows = [];

        for (const reqIt of items) {
          const pid = String(reqIt.productId);
          const q = Number(reqIt.quantity);
          const price = Number(priceByProduct.get(pid) || 0);

          refundTotal += price * q;
          refundItemRows.push({ productId: pid, quantity: q, price });
        }

        const paidSoFar = Number(sale.amountPaid || 0);
        const refundedSoFar = Number(sale.refundedTotal || 0);
        const refundableMoney = Math.max(0, paidSoFar - refundedSoFar);

        if (refundTotal > refundableMoney + 0.000001) {
          const e = new Error("REFUND_EXCEEDS_PAID");
          e.code = "REFUND_EXCEEDS_PAID";
          throw e;
        }

        const refund = await tx.saleRefund.create({
          data: {
            saleId: sale.id,
            tenantId,
            branchId: sale.branchId || null,
            createdById: userId,
            total: refundTotal,
            method: refundMethod,
            note: cleanNote,
            reason: cleanReason,
          },
          select: {
            id: true,
            branchId: true,
            total: true,
            method: true,
            note: true,
            reason: true,
            createdAt: true,
          },
        });

        for (const row of refundItemRows) {
          await tx.saleRefundItem.create({
            data: {
              refundId: refund.id,
              productId: row.productId,
              quantity: row.quantity,
              price: row.price,
            },
            select: { id: true },
          });

          await tryIncrementBranchInventoryTx(tx, {
            tenantId,
            branchId: sale.branchId || null,
            productId: row.productId,
            qty: row.quantity,
          });

          await tx.product.updateMany({
            where: { id: row.productId, tenantId, isActive: true },
            data: { stockQty: { increment: row.quantity } },
          });
        }

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            refundedTotal: { increment: refundTotal },
          },
          select: {
            id: true,
            branchId: true,
            total: true,
            ...saleTaxSnapshotSelect(tx),
            amountPaid: true,
            refundedTotal: true,
            balanceDue: true,
            status: true,
          },
        });

        let movement = null;
        if (paymentMethodTouchesCashDrawer(refundMethod)) {
          const openSessionId = await getOpenCashSessionId(tx, tenantId, sale.branchId);
          const shouldBlock = await getTenantCashDrawerPolicy(tx, tenantId);

          if (shouldBlock && !openSessionId) {
            throw new Error("CASH_DRAWER_CLOSED_FOR_BRANCH");
          }

          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            branchId: sale.branchId || null,
            userId,
            sessionId: openSessionId,
            type: "OUT",
            reason: "WITHDRAWAL",
            amount: refundTotal,
            note: `Refund ${refund.id} for sale ${sale.id} (${sale.branchId || "no-branch"})`,
          });
        }

        return {
          refund,
          sale: updatedSale,
          movement,
          auditMeta: {
            branchId: sale.branchId || null,
            refundId: refund.id,
            total: refundTotal,
            method: refundMethod,
            note: cleanNote,
            reason: cleanReason,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      branchId: result.auditMeta.branchId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "SALE_REFUNDED",
        ...result.auditMeta,
      },
    });

    return res.status(201).json({
      message: "Refund created",
      refund: result.refund,
      sale: result.sale,
      cashMovement: toCashMovementDto(result.movement),
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }
    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (code === "SALE_CANCELLED" || msg === "SALE_CANCELLED") {
      return res.status(400).json({ message: "Cannot refund a cancelled sale" });
    }

    if (msg.startsWith("NOT_IN_SALE:")) {
      return res.status(400).json({ message: "A product is not part of this sale" });
    }

    if (msg.startsWith("REFUND_TOO_MUCH:")) {
      return res.status(400).json({ message: "Refund quantity exceeds remaining sold quantity" });
    }

    if (code === "REFUND_EXCEEDS_PAID" || msg === "REFUND_EXCEEDS_PAID") {
      return res.status(400).json({ message: "Refund total exceeds the amount paid so far" });
    }

    if (msg === "CASH_DRAWER_CLOSED_FOR_BRANCH") {
      return res.status(409).json({
        message: "Cash drawer is closed for this sale branch",
        code: "CASH_DRAWER_CLOSED",
      });
    }

    console.error("createSaleRefund error:", err);
    return res.status(500).json({ message: "Failed to create refund" });
  }
}

module.exports = {
  quickPicks,
  createSale,
  createSaleWarranty,
  addSalePayment,
  listSales,
  getSaleReceipt,
  listOutstandingCredit,
  listOverdueCredit,
  cancelSale,
  createSaleRefund,
};