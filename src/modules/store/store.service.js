// src/modules/store/store.service.js
const path = require("path");
const prisma = require("../../config/database");
const {
  createPresignedImageUpload,
  isConfigured: isStorageConfigured,
} = require("../../lib/storage/objectStorage");
const { previewDocumentNumbers } = require("../documents/documentNumber.service");

const DEFAULT_COUNTRY_CODE = "RW";
const DEFAULT_CURRENCY_CODE = "RWF";
const DEFAULT_TIMEZONE = "Africa/Kigali";

const ALLOWED_LOGO_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

// Storvex is for electronics retail only.
const ALLOWED_SHOP_TYPES = new Set([
  "ELECTRONICS_RETAIL",
  "PHONE_SHOP",
  "LAPTOP_SHOP",
  "ACCESSORIES_SHOP",
  "REPAIR_SHOP",
  "MIXED_ELECTRONICS",
]);

const STORE_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "STOREKEEPER",
  "SELLER",
  "CASHIER",
  "TECHNICIAN",
]);

const OPERATIONAL_ROLES = new Set([
  "MANAGER",
  "STOREKEEPER",
  "SELLER",
  "CASHIER",
  "TECHNICIAN",
]);

function cleanString(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

function cleanNullableString(value, maxLen = null) {
  const s = cleanString(value);
  if (!s) return null;
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function cleanUpperString(value, fallback = null, maxLen = null) {
  const s = cleanNullableString(value, maxLen);
  if (!s) return fallback;
  return s.toUpperCase();
}

function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (digits.startsWith("07") && digits.length === 10) {
    return `250${digits.slice(1)}`;
  }

  if (digits.startsWith("2507") && digits.length === 12) {
    return digits;
  }

  return digits;
}

function normalizeEmail(value) {
  const s = cleanString(value);
  return s ? s.toLowerCase() : null;
}

function normalizeShopType(value) {
  const raw = cleanUpperString(value, null, 80);
  if (!raw) return null;

  // Backward-safe aliases
  if (raw === "ELECTRONICS") return "ELECTRONICS_RETAIL";
  if (raw === "PHONE") return "PHONE_SHOP";
  if (raw === "LAPTOP") return "LAPTOP_SHOP";
  if (raw === "ACCESSORIES") return "ACCESSORIES_SHOP";
  if (raw === "REPAIRS") return "REPAIR_SHOP";

  if (!ALLOWED_SHOP_TYPES.has(raw)) {
    const err = new Error(
      "shopType must be one of ELECTRONICS_RETAIL, PHONE_SHOP, LAPTOP_SHOP, ACCESSORIES_SHOP, REPAIR_SHOP, MIXED_ELECTRONICS"
    );
    err.status = 400;
    throw err;
  }

  return raw;
}

function normalizeCountryCode(value) {
  return cleanUpperString(value, DEFAULT_COUNTRY_CODE, 8) || DEFAULT_COUNTRY_CODE;
}

function normalizeCurrencyCode(value) {
  return cleanUpperString(value, DEFAULT_CURRENCY_CODE, 8) || DEFAULT_CURRENCY_CODE;
}

function normalizeTimezone(value) {
  return cleanNullableString(value, 100) || DEFAULT_TIMEZONE;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return fallback;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function daysBetweenCeil(futureDate, now = new Date()) {
  const ms = new Date(futureDate).getTime() - new Date(now).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function buildTrialBanner(subscription, now = new Date()) {
  if (!subscription) {
    return {
      visible: false,
      kind: null,
      title: null,
      message: null,
      daysLeft: null,
      accessMode: null,
      endDate: null,
      graceEndDate: null,
    };
  }

  const accessMode = String(subscription.accessMode || "").toUpperCase();

  if (accessMode === "TRIAL") {
    const end = subscription.trialEndDate || subscription.endDate;
    const daysLeft = end ? daysBetweenCeil(end, now) : null;

    let kind = "info";
    let title = "Free trial active";
    let message =
      daysLeft == null
        ? "Your free trial is active."
        : `Trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;

    if (daysLeft != null && daysLeft <= 3) {
      kind = "danger";
      title = "Trial ending very soon";
      message = `Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} left. Renew soon to avoid interruption.`;
    } else if (daysLeft != null && daysLeft <= 10) {
      kind = "warning";
      title = "Trial ending soon";
      message = `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`;
    }

    return {
      visible: true,
      kind,
      title,
      message,
      daysLeft,
      accessMode,
      endDate: end || null,
      graceEndDate: subscription.graceEndDate || null,
    };
  }

  if (accessMode === "GRACE") {
    const graceEnd = subscription.graceEndDate || null;
    const daysLeft = graceEnd ? daysBetweenCeil(graceEnd, now) : null;

    return {
      visible: true,
      kind: "danger",
      title: "Subscription grace period",
      message:
        daysLeft == null
          ? "Your subscription has expired. Renew now to keep selling."
          : `Your subscription has expired. ${daysLeft} day${daysLeft === 1 ? "" : "s"} left before read-only mode.`,
      daysLeft,
      accessMode,
      endDate: subscription.endDate || null,
      graceEndDate: graceEnd,
    };
  }

  if (accessMode === "READ_ONLY") {
    return {
      visible: true,
      kind: "danger",
      title: "Subscription expired",
      message: "Your account is in read-only mode. Renew to continue operations.",
      daysLeft: 0,
      accessMode,
      endDate: subscription.endDate || null,
      graceEndDate: subscription.graceEndDate || null,
    };
  }

  if (accessMode === "SUSPENDED") {
    return {
      visible: true,
      kind: "danger",
      title: "Account suspended",
      message: "This account is suspended. Contact support.",
      daysLeft: null,
      accessMode,
      endDate: subscription.endDate || null,
      graceEndDate: subscription.graceEndDate || null,
    };
  }

  return {
    visible: false,
    kind: null,
    title: null,
    message: null,
    daysLeft: null,
    accessMode,
    endDate: subscription.endDate || null,
    graceEndDate: subscription.graceEndDate || null,
  };
}

function serializeStoreProfileRow(tenant) {
  if (!tenant) return null;

  return {
    id: tenant.id,
    name: tenant.name || null,
    email: tenant.email || null,
    phone: tenant.phone || null,
    status: tenant.status || null,
    shopType: tenant.shopType || null,
    district: tenant.district || null,
    sector: tenant.sector || null,
    address: tenant.address || null,
    countryCode: tenant.countryCode || DEFAULT_COUNTRY_CODE,
    currencyCode: tenant.currencyCode || DEFAULT_CURRENCY_CODE,
    timezone: tenant.timezone || DEFAULT_TIMEZONE,
    logoUrl: tenant.logoUrl || null,
    logoKey: tenant.logoKey || null,
    receiptHeader: tenant.receiptHeader || null,
    receiptFooter: tenant.receiptFooter || null,
    onboardingCompleted: Boolean(tenant.onboardingCompleted),
    onboardingCompletedAt: toIsoOrNull(tenant.onboardingCompletedAt),
    cashDrawerBlockCashSales:
      typeof tenant.cash_drawer_block_cash_sales === "boolean"
        ? tenant.cash_drawer_block_cash_sales
        : true,
    createdAt: toIsoOrNull(tenant.createdAt),
  };
}

function sanitizePrefix(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return cleaned || fallback;
}

function sanitizeHexColor(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const normalized = raw.startsWith("#") ? raw : `#${raw}`;

  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const r = normalized[1];
    const g = normalized[2];
    const b = normalized[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return fallback;
}

function clampPadding(value, fallback = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(4, Math.min(10, Math.round(n)));
}

function sanitizeFilename(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : ".png";
}

function buildTenantLogoKey(tenantId, filename) {
  const ext = sanitizeFilename(filename);
  const stamp = Date.now();
  return `tenant-assets/${tenantId}/logos/logo-${stamp}${ext}`;
}

function assertTenantId(tenantId) {
  const id = cleanString(tenantId);
  if (!id) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }
  return id;
}

function assertRequiredProfileFields(data) {
  const requiredProfileFields = {
    name: "Store name is required",
    email: "Store email is required",
    phone: "Store phone is required",
    shopType: "Store category is required",
    district: "District is required",
    sector: "Sector is required",
    address: "Address is required",
  };

  for (const [key, message] of Object.entries(requiredProfileFields)) {
    if (key in data && !data[key]) {
      const err = new Error(message);
      err.status = 400;
      throw err;
    }
  }

  if ("email" in data && data.email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
    if (!ok) {
      const err = new Error("Store email is invalid");
      err.status = 400;
      throw err;
    }
  }

  if ("phone" in data && data.phone) {
    const digits = String(data.phone).replace(/[^\d]/g, "");
    if (digits.length < 10) {
      const err = new Error("Store phone is invalid");
      err.status = 400;
      throw err;
    }
  }
}

async function getStoreProfile(tenantId) {
  const id = assertTenantId(tenantId);

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
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
      onboardingCompleted: true,
      onboardingCompletedAt: true,
      cash_drawer_block_cash_sales: true,
      createdAt: true,
    },
  });

  return serializeStoreProfileRow(tenant);
}

async function getSetupChecklist(tenantId, subscription = null) {
  const id = assertTenantId(tenantId);

  const [tenant, userCounts, productAgg] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        shopType: true,
        district: true,
        sector: true,
        address: true,
        logoUrl: true,
        receiptHeader: true,
        receiptFooter: true,
        onboardingCompleted: true,
        onboardingCompletedAt: true,
        cash_drawer_block_cash_sales: true,
      },
    }),
    prisma.user.groupBy({
      by: ["role"],
      where: { tenantId: id, isActive: true },
      _count: { role: true },
    }),
    prisma.product.aggregate({
      where: { tenantId: id, isActive: true },
      _count: { id: true },
      _sum: { stockQty: true },
    }),
  ]);

  if (!tenant) return null;

  const roleCount = Object.fromEntries(
    (userCounts || []).map((r) => [String(r.role || ""), Number(r._count?.role || 0)])
  );

  const activeOwners = Number(roleCount.OWNER || 0);
  const activeManagers = Number(roleCount.MANAGER || 0);
  const activeStorekeepers = Number(roleCount.STOREKEEPER || 0);
  const activeSellers = Number(roleCount.SELLER || 0);
  const activeCashiers = Number(roleCount.CASHIER || 0);
  const activeTechnicians = Number(roleCount.TECHNICIAN || 0);

  const activeOperationalUsers = Object.entries(roleCount).reduce((sum, [role, count]) => {
    return OPERATIONAL_ROLES.has(role) ? sum + Number(count || 0) : sum;
  }, 0);

  const activeKnownStoreUsers = Object.entries(roleCount).reduce((sum, [role, count]) => {
    return STORE_ROLES.has(role) ? sum + Number(count || 0) : sum;
  }, 0);

  const activeProductCount = Number(productAgg?._count?.id || 0);
  const stockQtyTotal = Number(productAgg?._sum?.stockQty || 0);

  const checks = [
    {
      key: "store_identity",
      label: "Store identity",
      required: true,
      done: Boolean(tenant.name && tenant.phone && tenant.email && tenant.shopType),
      detail: "Store name, phone, email, and electronics retail category are set.",
    },
    {
      key: "store_location",
      label: "Store location",
      required: true,
      done: Boolean(tenant.district && tenant.sector && tenant.address),
      detail: "District, sector, and address are set.",
    },
    {
      key: "receipt_branding",
      label: "Receipt branding",
      required: false,
      done: Boolean(tenant.logoUrl || tenant.receiptHeader || tenant.receiptFooter),
      detail: "Logo, receipt header, or receipt footer configured.",
    },
    {
      key: "staff_setup",
      label: "Staff setup",
      required: false,
      done: activeOperationalUsers > 0,
      detail: "At least one active manager, storekeeper, seller, cashier, or technician exists.",
    },
    {
      key: "inventory_seeded",
      label: "Inventory loaded",
      required: true,
      done: activeProductCount > 0,
      detail: "At least one active product exists.",
    },
    {
      key: "stock_available",
      label: "Stock available",
      required: true,
      done: stockQtyTotal > 0,
      detail: "At least one unit is in stock.",
    },
    {
      key: "cash_policy_set",
      label: "Cash drawer policy",
      required: false,
      done: typeof tenant.cash_drawer_block_cash_sales === "boolean",
      detail: "Cash sales policy is configured.",
    },
  ];

  const requiredChecks = checks.filter((c) => c.required);
  const requiredDoneCount = requiredChecks.filter((c) => c.done).length;
  const recommendedDoneCount = checks.filter((c) => c.done).length;
  const allRequiredDone = requiredChecks.every((c) => c.done);
  const readinessPercent = Math.round((recommendedDoneCount / checks.length) * 100);

  return {
    tenantId: id,
    isOperationallyReady: allRequiredDone,
    onboardingCompleted: Boolean(tenant.onboardingCompleted),
    onboardingCompletedAt: toIsoOrNull(tenant.onboardingCompletedAt),
    readinessPercent,
    counts: {
      activeOwners,
      activeManagers,
      activeStorekeepers,
      activeSellers,
      activeCashiers,
      activeTechnicians,
      activeKnownStoreUsers,
      activeProducts: activeProductCount,
      totalStockUnits: stockQtyTotal,
    },
    checks,
    summary: {
      total: checks.length,
      done: checks.filter((c) => c.done).length,
      requiredTotal: requiredChecks.length,
      requiredDone: requiredDoneCount,
      missingRequiredKeys: requiredChecks.filter((c) => !c.done).map((c) => c.key),
    },
    trialBanner: buildTrialBanner(subscription),
  };
}

async function updateStoreProfile(tenantId, payload) {
  const id = assertTenantId(tenantId);
  const body = payload || {};
  const data = {};

  if ("name" in body) data.name = cleanNullableString(body.name, 180);
  if ("email" in body) data.email = normalizeEmail(body.email);
  if ("phone" in body) data.phone = normalizePhone(body.phone);
  if ("shopType" in body) data.shopType = normalizeShopType(body.shopType);
  if ("district" in body) data.district = cleanNullableString(body.district, 120);
  if ("sector" in body) data.sector = cleanNullableString(body.sector, 120);
  if ("address" in body) data.address = cleanNullableString(body.address, 255);
  if ("logoUrl" in body) data.logoUrl = cleanNullableString(body.logoUrl, 1000);
  if ("logoKey" in body) data.logoKey = cleanNullableString(body.logoKey, 1000);
  if ("receiptHeader" in body) data.receiptHeader = cleanNullableString(body.receiptHeader, 1000);
  if ("receiptFooter" in body) data.receiptFooter = cleanNullableString(body.receiptFooter, 1000);
  if ("countryCode" in body) data.countryCode = normalizeCountryCode(body.countryCode);
  if ("currencyCode" in body) data.currencyCode = normalizeCurrencyCode(body.currencyCode);
  if ("timezone" in body) data.timezone = normalizeTimezone(body.timezone);
  if ("cashDrawerBlockCashSales" in body) {
    data.cash_drawer_block_cash_sales = toBool(body.cashDrawerBlockCashSales, true);
  }

  assertRequiredProfileFields(data);

  const updated = await prisma.tenant.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
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
      onboardingCompleted: true,
      onboardingCompletedAt: true,
      cash_drawer_block_cash_sales: true,
      createdAt: true,
    },
  });

  const checklist = await getSetupChecklist(id);

  const shouldMarkComplete =
    checklist?.isOperationallyReady === true &&
    updated.onboardingCompleted !== true;

  const shouldMarkIncomplete =
    checklist?.isOperationallyReady === false &&
    updated.onboardingCompleted === true;

  let finalTenant = updated;

  if (shouldMarkComplete) {
    finalTenant = await prisma.tenant.update({
      where: { id },
      data: {
        onboardingCompleted: true,
        onboardingCompletedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
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
        onboardingCompleted: true,
        onboardingCompletedAt: true,
        cash_drawer_block_cash_sales: true,
        createdAt: true,
      },
    });
  } else if (shouldMarkIncomplete) {
    finalTenant = await prisma.tenant.update({
      where: { id },
      data: {
        onboardingCompleted: false,
        onboardingCompletedAt: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
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
        onboardingCompleted: true,
        onboardingCompletedAt: true,
        cash_drawer_block_cash_sales: true,
        createdAt: true,
      },
    });
  }

  return serializeStoreProfileRow(finalTenant);
}

async function getDocumentSettings(tenantId) {
  const id = assertTenantId(tenantId);

  const [settings, previews] = await Promise.all([
    prisma.tenantDocumentSettings.upsert({
      where: { tenantId: id },
      update: {},
      create: { tenantId: id },
    }),
    previewDocumentNumbers(prisma, id),
  ]);

  return {
    tenantId: id,

    receiptPrefix: settings.receiptPrefix,
    invoicePrefix: settings.invoicePrefix,
    warrantyPrefix: settings.warrantyPrefix,
    proformaPrefix: settings.proformaPrefix,

    receiptPadding: settings.receiptPadding,
    invoicePadding: settings.invoicePadding,
    warrantyPadding: settings.warrantyPadding,
    proformaPadding: settings.proformaPadding,

    invoiceTerms: settings.invoiceTerms,
    warrantyTerms: settings.warrantyTerms,
    proformaTerms: settings.proformaTerms,
    deliveryNoteTerms: settings.deliveryNoteTerms,

    documentPrimaryColor: settings.documentPrimaryColor || "#0F4C81",
    documentAccentColor: settings.documentAccentColor || "#E8EEF5",

    ...previews,
  };
}

async function updateDocumentSettings(tenantId, payload) {
  const id = assertTenantId(tenantId);
  const body = payload || {};

  const updateData = {
    receiptPrefix: sanitizePrefix(body.receiptPrefix, "RCT"),
    invoicePrefix: sanitizePrefix(body.invoicePrefix, "INV"),
    warrantyPrefix: sanitizePrefix(body.warrantyPrefix, "WAR"),
    proformaPrefix: sanitizePrefix(body.proformaPrefix, "PRF"),

    receiptPadding: clampPadding(body.receiptPadding, 6),
    invoicePadding: clampPadding(body.invoicePadding, 6),
    warrantyPadding: clampPadding(body.warrantyPadding, 6),
    proformaPadding: clampPadding(body.proformaPadding, 6),

    invoiceTerms: cleanNullableString(body.invoiceTerms, 4000),
    warrantyTerms: cleanNullableString(body.warrantyTerms, 4000),
    proformaTerms: cleanNullableString(body.proformaTerms, 4000),
    deliveryNoteTerms: cleanNullableString(body.deliveryNoteTerms, 4000),

    documentPrimaryColor: sanitizeHexColor(body.documentPrimaryColor, "#0F4C81"),
    documentAccentColor: sanitizeHexColor(body.documentAccentColor, "#E8EEF5"),
  };

  const updated = await prisma.tenantDocumentSettings.upsert({
    where: { tenantId: id },
    update: updateData,
    create: {
      tenantId: id,
      ...updateData,
    },
  });

  const previews = await previewDocumentNumbers(prisma, id);

  return {
    tenantId: id,

    receiptPrefix: updated.receiptPrefix,
    invoicePrefix: updated.invoicePrefix,
    warrantyPrefix: updated.warrantyPrefix,
    proformaPrefix: updated.proformaPrefix,

    receiptPadding: updated.receiptPadding,
    invoicePadding: updated.invoicePadding,
    warrantyPadding: updated.warrantyPadding,
    proformaPadding: updated.proformaPadding,

    invoiceTerms: updated.invoiceTerms,
    warrantyTerms: updated.warrantyTerms,
    proformaTerms: updated.proformaTerms,
    deliveryNoteTerms: updated.deliveryNoteTerms,

    documentPrimaryColor: updated.documentPrimaryColor || "#0F4C81",
    documentAccentColor: updated.documentAccentColor || "#E8EEF5",

    ...previews,
  };
}

async function createLogoUploadContract(tenantId, { filename, contentType, sizeBytes } = {}) {
  const id = assertTenantId(tenantId);

  const normalizedContentType = String(contentType || "").toLowerCase();
  if (!ALLOWED_LOGO_CONTENT_TYPES.has(normalizedContentType)) {
    const err = new Error("Only PNG, JPEG, and WEBP logos are allowed");
    err.status = 400;
    throw err;
  }

  const safeFilename = cleanString(filename);
  if (!safeFilename) {
    const err = new Error("filename is required");
    err.status = 400;
    throw err;
  }

  const size = Number(sizeBytes || 0);
  if (!Number.isFinite(size) || size <= 0 || size > 3 * 1024 * 1024) {
    const err = new Error("Logo must be 3MB or smaller");
    err.status = 400;
    throw err;
  }

  if (!isStorageConfigured()) {
    const err = new Error("Object storage is not configured");
    err.status = 503;
    throw err;
  }

  const objectKey = buildTenantLogoKey(id, safeFilename);

  return createPresignedImageUpload({
    key: objectKey,
    contentType: normalizedContentType,
  });
}

module.exports = {
  buildTrialBanner,
  getStoreProfile,
  getSetupChecklist,
  updateStoreProfile,
  getDocumentSettings,
  updateDocumentSettings,
  createLogoUploadContract,
};