"use strict";

const { signGetUrl } = require("../../utils/r2");

function hasField(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

function cleanString(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

function pickFirst(...values) {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) return cleaned;
  }

  return null;
}

function buildLocationText(...parts) {
  return parts.map(cleanString).filter(Boolean).join(", ") || null;
}

function buildDocumentSettingsSelect(prisma) {
  return {
    invoiceTerms: true,
    warrantyTerms: true,

    ...(hasField(prisma.tenantDocumentSettings, "proformaTerms")
      ? { proformaTerms: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "deliveryNoteTerms")
      ? { deliveryNoteTerms: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "documentPrimaryColor")
      ? { documentPrimaryColor: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "documentAccentColor")
      ? { documentAccentColor: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "documentHeaderDisplay")
      ? { documentHeaderDisplay: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "documentSizeMode")
      ? { documentSizeMode: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "taxMode")
      ? { taxMode: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "taxDisplayMode")
      ? { taxDisplayMode: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "taxName")
      ? { taxName: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "taxRateBps")
      ? { taxRateBps: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "pricesIncludeTax")
      ? { pricesIncludeTax: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "showTaxOnCustomerDocuments")
      ? { showTaxOnCustomerDocuments: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "receiptPrefix")
      ? { receiptPrefix: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "invoicePrefix")
      ? { invoicePrefix: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "warrantyPrefix")
      ? { warrantyPrefix: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "proformaPrefix")
      ? { proformaPrefix: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "receiptPadding")
      ? { receiptPadding: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "invoicePadding")
      ? { invoicePadding: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "warrantyPadding")
      ? { warrantyPadding: true }
      : {}),

    ...(hasField(prisma.tenantDocumentSettings, "proformaPadding")
      ? { proformaPadding: true }
      : {}),
  };
}

function buildTenantSelect(prisma) {
  return {
    id: true,
    name: true,
    phone: true,
    email: true,

    ...(hasField(prisma.tenant, "shopType") ? { shopType: true } : {}),
    ...(hasField(prisma.tenant, "district") ? { district: true } : {}),
    ...(hasField(prisma.tenant, "sector") ? { sector: true } : {}),
    ...(hasField(prisma.tenant, "address") ? { address: true } : {}),
    ...(hasField(prisma.tenant, "countryCode") ? { countryCode: true } : {}),
    ...(hasField(prisma.tenant, "currencyCode") ? { currencyCode: true } : {}),
    ...(hasField(prisma.tenant, "timezone") ? { timezone: true } : {}),
    ...(hasField(prisma.tenant, "taxId") ? { taxId: true } : {}),
    ...(hasField(prisma.tenant, "tinNumber") ? { tinNumber: true } : {}),

    logoUrl: true,
    logoKey: true,
    receiptHeader: true,
    receiptFooter: true,

    documentSettings: {
      select: buildDocumentSettingsSelect(prisma),
    },
  };
}

function buildBranchSelect(prisma) {
  return {
    id: true,

    ...(hasField(prisma.branch, "name") ? { name: true } : {}),
    ...(hasField(prisma.branch, "code") ? { code: true } : {}),
    ...(hasField(prisma.branch, "type") ? { type: true } : {}),
    ...(hasField(prisma.branch, "status") ? { status: true } : {}),
    ...(hasField(prisma.branch, "isMain") ? { isMain: true } : {}),
    ...(hasField(prisma.branch, "district") ? { district: true } : {}),
    ...(hasField(prisma.branch, "sector") ? { sector: true } : {}),
    ...(hasField(prisma.branch, "address") ? { address: true } : {}),
    ...(hasField(prisma.branch, "phone") ? { phone: true } : {}),
    ...(hasField(prisma.branch, "email") ? { email: true } : {}),
  };
}

async function getSignedLogoUrl(logoKey) {
  if (!logoKey) return null;

  try {
    return await signGetUrl(logoKey, 300);
  } catch (err) {
    console.error("signGetUrl failed:", err?.message || err);
    return null;
  }
}

async function findBranch(prisma, tenantId, locationId) {
  const branchId = cleanString(locationId);

  if (!tenantId || !branchId || !prisma.branch) {
    return null;
  }

  try {
    return await prisma.branch.findFirst({
      where: {
        id: branchId,
        tenantId: String(tenantId),
      },
      select: buildBranchSelect(prisma),
    });
  } catch (err) {
    console.error("findBranch for document branding failed:", err?.message || err);
    return null;
  }
}

function serializeLocation({ branch, tenant }) {
  const tenantLocation = buildLocationText(
    tenant?.sector,
    tenant?.district,
    tenant?.address,
  );

  const branchLocation = buildLocationText(
    branch?.sector,
    branch?.district,
    branch?.address,
  );

  const locationName = pickFirst(
    branch?.name,
    branch?.code,
    tenant?.name,
    "Main store",
  );

  const locationCode = cleanString(branch?.code);
  const locationStatus = cleanString(branch?.status);
  const locationPhone = pickFirst(branch?.phone, tenant?.phone);
  const locationEmail = pickFirst(branch?.email, tenant?.email);
  const locationAddress = pickFirst(branchLocation, tenantLocation);

  return {
    id: branch?.id || null,

    branchName: branch?.name || null,
    branchCode: branch?.code || null,

    locationName,
    locationCode,
    locationStatus,
    locationPhone,
    locationEmail,
    locationAddress,
    sellingLocation: locationName,
    storeLocation: locationName,
    isMainLocation: Boolean(branch?.isMain),
  };
}

function normalizeHeaderDisplay(value) {
  const mode = String(value || "LOGO_AND_NAME").trim().toUpperCase();

  if (mode === "LOGO_ONLY") return "LOGO_ONLY";
  if (mode === "NAME_ONLY") return "NAME_ONLY";

  return "LOGO_AND_NAME";
}

function normalizeDocumentSizeMode(value) {
  const mode = String(value || "AUTO").trim().toUpperCase();

  if (mode === "COMPACT") return "COMPACT";
  if (mode === "STANDARD") return "STANDARD";

  return "AUTO";
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

async function buildTenantDocumentBranding(prisma, tenantId, locationId = null) {
  const cleanTenantId = cleanString(tenantId);

  if (!cleanTenantId) {
    return null;
  }

  const tenant = await prisma.tenant.findFirst({
    where: { id: cleanTenantId },
    select: buildTenantSelect(prisma),
  });

  if (!tenant) {
    return null;
  }

  const branch = await findBranch(prisma, cleanTenantId, locationId);
  const logoSignedUrl = await getSignedLogoUrl(tenant.logoKey);
  const location = serializeLocation({ branch, tenant });
  const settings = tenant.documentSettings || {};

  const tenantLocation = buildLocationText(
    tenant.sector,
    tenant.district,
    tenant.address,
  );

  return {
    id: tenant.id,

    name: tenant.name || null,
    phone: location.locationPhone || tenant.phone || null,
    email: location.locationEmail || tenant.email || null,
    shopType: tenant.shopType || null,
    district: tenant.district || null,
    sector: tenant.sector || null,
    address: tenant.address || null,
    countryCode: tenant.countryCode || "RW",
    currencyCode: tenant.currencyCode || "RWF",
    timezone: tenant.timezone || "Africa/Kigali",
    taxId: tenant.taxId || tenant.tinNumber || null,
    tin: tenant.taxId || tenant.tinNumber || null,

    logoUrl: tenant.logoUrl || null,
    logoKey: tenant.logoKey || null,
    logoSignedUrl: logoSignedUrl || tenant.logoUrl || null,

    receiptHeader: tenant.receiptHeader || null,
    receiptFooter: tenant.receiptFooter || null,

    documentPrimaryColor: settings.documentPrimaryColor || "#0F4C81",
    documentAccentColor: settings.documentAccentColor || "#E8EEF5",

    documentHeaderDisplay: normalizeHeaderDisplay(settings.documentHeaderDisplay),
    documentSizeMode: normalizeDocumentSizeMode(settings.documentSizeMode),

    taxMode: normalizeTaxMode(settings.taxMode),
    taxDisplayMode: normalizeTaxDisplayMode(settings.taxDisplayMode),
    taxName: settings.taxName || null,
    taxRateBps: Number(settings.taxRateBps || 0),
    pricesIncludeTax: Boolean(settings.pricesIncludeTax),
    showTaxOnCustomerDocuments: Boolean(settings.showTaxOnCustomerDocuments),

    invoiceTerms: settings.invoiceTerms || null,
    warrantyTerms: settings.warrantyTerms || null,
    proformaTerms: settings.proformaTerms || null,
    deliveryNoteTerms: settings.deliveryNoteTerms || null,

    receiptPrefix: settings.receiptPrefix || "RCT",
    invoicePrefix: settings.invoicePrefix || "INV",
    warrantyPrefix: settings.warrantyPrefix || "WAR",
    proformaPrefix: settings.proformaPrefix || "PRF",

    receiptPadding: Number(settings.receiptPadding || 3),
    invoicePadding: Number(settings.invoicePadding || 3),
    warrantyPadding: Number(settings.warrantyPadding || 3),
    proformaPadding: Number(settings.proformaPadding || 3),

    locationId: location.id,
    locationName: location.locationName,
    locationCode: location.locationCode,
    locationStatus: location.locationStatus,
    locationPhone: location.locationPhone,
    locationEmail: location.locationEmail,
    locationAddress: location.locationAddress || tenantLocation,
    sellingLocation: location.sellingLocation,
    storeLocation: location.storeLocation,
    isMainLocation: location.isMainLocation,

    branchName: location.branchName,
    branchCode: location.branchCode,
  };
}

module.exports = {
  buildTenantDocumentBranding,
};