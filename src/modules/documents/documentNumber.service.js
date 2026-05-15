"use strict";

function toBigIntSafe(value, fallback = 1n) {
  try {
    if (typeof value === "bigint") return value;
    if (value == null) return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
}

function cleanString(value) {
  const s = String(value ?? "").trim();
  return s || "";
}

function normalizePrefix(value, fallback) {
  const raw = cleanString(value || fallback).toUpperCase();
  const safe = raw.replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return safe || fallback;
}

function normalizePadding(value, fallback = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), 3), 12);
}



function documentYear(date) {
  const d = new Date(date || new Date());
  if (Number.isNaN(d.getTime())) return new Date().getFullYear();
  return d.getFullYear();
}



async function ensureSettingsTx(tx, tenantId) {
  const cleanTenantId = cleanString(tenantId);

  if (!cleanTenantId) {
    const err = new Error("Store is required before creating a document number");
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  let settings = await tx.tenantDocumentSettings.findUnique({
    where: { tenantId: cleanTenantId },
  });

  if (!settings) {
    settings = await tx.tenantDocumentSettings.create({
      data: { tenantId: cleanTenantId },
    });
  }

  return settings;
}

async function ensureCounterTx(tx, tenantId) {
  const cleanTenantId = cleanString(tenantId);

  if (!cleanTenantId) {
    const err = new Error("Store is required before creating a document number");
    err.code = "TENANT_REQUIRED";
    throw err;
  }

  let counter = await tx.tenantDocumentCounter.findUnique({
    where: { tenantId: cleanTenantId },
  });

  if (!counter) {
    counter = await tx.tenantDocumentCounter.create({
      data: { tenantId: cleanTenantId },
    });
  }

  return counter;
}

function padSeq(seq, padding) {
  return String(seq).padStart(Number(padding || 3), "0");
}

function docYear(date) {
  const d = new Date(date || new Date());
  return String(d.getUTCFullYear());
}

function formatDocumentNumber(prefix, seq, padding, date) {
  return `${prefix}-${docYear(date)}-${padSeq(seq, padding)}`;
}

function normalizeSettings(settings) {
  return {
    receiptPrefix: settings?.receiptPrefix || "RCT",
    invoicePrefix: settings?.invoicePrefix || "INV",
    warrantyPrefix: settings?.warrantyPrefix || "WAR",
    proformaPrefix: settings?.proformaPrefix || "PRF",

    receiptPadding: Number(settings?.receiptPadding || 3),
    invoicePadding: Number(settings?.invoicePadding || 3),
    warrantyPadding: Number(settings?.warrantyPadding || 3),
    proformaPadding: Number(settings?.proformaPadding || 3),
  };
}

function normalizeCounter(counter) {
  return {
    nextReceiptSeq: toBigIntSafe(counter?.nextReceiptSeq, 1n),
    nextInvoiceSeq: toBigIntSafe(counter?.nextInvoiceSeq, 1n),
    nextWarrantySeq: toBigIntSafe(counter?.nextWarrantySeq, 1n),
    nextProformaSeq: toBigIntSafe(counter?.nextProformaSeq, 1n),
  };
}

async function previewDocumentNumbers(prisma, tenantId, date = new Date()) {
  const cleanTenantId = cleanString(tenantId);

  if (!cleanTenantId) {
    return {
      receiptNumberPreview: "RCT-2026-001",
      invoiceNumberPreview: "INV-2026-001",
      warrantyNumberPreview: "WAR-2026-001",
      proformaNumberPreview: "PRF-2026-001",
    };
  }

  const [settingsRaw, counterRaw] = await Promise.all([
    prisma.tenantDocumentSettings.findUnique({
      where: { tenantId: cleanTenantId },
    }),
    prisma.tenantDocumentCounter.findUnique({
      where: { tenantId: cleanTenantId },
    }),
  ]);

  const settings = normalizeSettings(settingsRaw);
  const counter = normalizeCounter(counterRaw);

  return {
    receiptNumberPreview: formatDocumentNumber(
      settings.receiptPrefix,
      counter.nextReceiptSeq,
      settings.receiptPadding,
      date
    ),
    invoiceNumberPreview: formatDocumentNumber(
      settings.invoicePrefix,
      counter.nextInvoiceSeq,
      settings.invoicePadding,
      date
    ),
    warrantyNumberPreview: formatDocumentNumber(
      settings.warrantyPrefix,
      counter.nextWarrantySeq,
      settings.warrantyPadding,
      date
    ),
    proformaNumberPreview: formatDocumentNumber(
      settings.proformaPrefix,
      counter.nextProformaSeq,
      settings.proformaPadding,
      date
    ),
  };
}

async function reserveSaleDocumentNumbersTx(tx, { tenantId, createdAt = new Date() }) {
  const cleanTenantId = cleanString(tenantId);

  const settingsRaw = await ensureSettingsTx(tx, cleanTenantId);
  const counterRaw = await ensureCounterTx(tx, cleanTenantId);

  const settings = normalizeSettings(settingsRaw);
  const counter = normalizeCounter(counterRaw);

  const receiptSeq = counter.nextReceiptSeq;
  const invoiceSeq = counter.nextInvoiceSeq;

  const receiptNumber = formatDocumentNumber(
    settings.receiptPrefix,
    receiptSeq,
    settings.receiptPadding,
    createdAt
  );

  const invoiceNumber = formatDocumentNumber(
    settings.invoicePrefix,
    invoiceSeq,
    settings.invoicePadding,
    createdAt
  );

  await tx.tenantDocumentCounter.update({
    where: { tenantId: cleanTenantId },
    data: {
      nextReceiptSeq: receiptSeq + 1n,
      nextInvoiceSeq: invoiceSeq + 1n,
    },
  });

  return {
    receiptNumber,
    invoiceNumber,
  };
}

async function reserveWarrantyDocumentNumberTx(tx, { tenantId, createdAt = new Date() }) {
  const cleanTenantId = cleanString(tenantId);

  const settingsRaw = await ensureSettingsTx(tx, cleanTenantId);
  const counterRaw = await ensureCounterTx(tx, cleanTenantId);

  const settings = normalizeSettings(settingsRaw);
  const counter = normalizeCounter(counterRaw);

  const warrantySeq = counter.nextWarrantySeq;

  const warrantyNumber = formatDocumentNumber(
    settings.warrantyPrefix,
    warrantySeq,
    settings.warrantyPadding,
    createdAt
  );

  await tx.tenantDocumentCounter.update({
    where: { tenantId: cleanTenantId },
    data: {
      nextWarrantySeq: warrantySeq + 1n,
    },
  });

  return {
    warrantyNumber,
  };
}

async function reserveProformaDocumentNumberTx(tx, { tenantId, createdAt = new Date() }) {
  const cleanTenantId = cleanString(tenantId);

  const settingsRaw = await ensureSettingsTx(tx, cleanTenantId);
  const counterRaw = await ensureCounterTx(tx, cleanTenantId);

  const settings = normalizeSettings(settingsRaw);
  const counter = normalizeCounter(counterRaw);

  const proformaSeq = counter.nextProformaSeq;

  const proformaNumber = formatDocumentNumber(
    settings.proformaPrefix,
    proformaSeq,
    settings.proformaPadding,
    createdAt
  );

  await tx.tenantDocumentCounter.update({
    where: { tenantId: cleanTenantId },
    data: {
      nextProformaSeq: proformaSeq + 1n,
    },
  });

  return {
    proformaNumber,
  };
}

module.exports = {
  previewDocumentNumbers,
  reserveSaleDocumentNumbersTx,
  reserveWarrantyDocumentNumberTx,
  reserveProformaDocumentNumberTx,
  formatDocumentNumber,
};