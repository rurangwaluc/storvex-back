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

function padSeq(seq, padding) {
  return String(seq).padStart(Number(padding || 6), "0");
}

function ym(date) {
  const d = new Date(date || new Date());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function formatDocumentNumber(prefix, seq, padding, date) {
  return `${prefix}-${ym(date)}-${padSeq(seq, padding)}`;
}

async function ensureSettingsTx(tx, tenantId) {
  let settings = await tx.tenantDocumentSettings.findUnique({
    where: { tenantId: String(tenantId) },
  });

  if (!settings) {
    settings = await tx.tenantDocumentSettings.create({
      data: { tenantId: String(tenantId) },
    });
  }

  return settings;
}

async function ensureCounterTx(tx, tenantId) {
  let counter = await tx.tenantDocumentCounter.findUnique({
    where: { tenantId: String(tenantId) },
  });

  if (!counter) {
    counter = await tx.tenantDocumentCounter.create({
      data: { tenantId: String(tenantId) },
    });
  }

  return counter;
}

function normalizeSettings(settings) {
  return {
    receiptPrefix: settings?.receiptPrefix || "RCT",
    invoicePrefix: settings?.invoicePrefix || "INV",
    warrantyPrefix: settings?.warrantyPrefix || "WAR",
    proformaPrefix: settings?.proformaPrefix || "PRF",

    receiptPadding: Number(settings?.receiptPadding || 6),
    invoicePadding: Number(settings?.invoicePadding || 6),
    warrantyPadding: Number(settings?.warrantyPadding || 6),
    proformaPadding: Number(settings?.proformaPadding || 6),
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
  const [settingsRaw, counterRaw] = await Promise.all([
    prisma.tenantDocumentSettings.findUnique({
      where: { tenantId: String(tenantId) },
    }),
    prisma.tenantDocumentCounter.findUnique({
      where: { tenantId: String(tenantId) },
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

async function reserveSaleDocumentNumbersTx(tx, { tenantId, createdAt }) {
  const settingsRaw = await ensureSettingsTx(tx, tenantId);
  const counterRaw = await ensureCounterTx(tx, tenantId);

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
    where: { tenantId: String(tenantId) },
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

async function reserveWarrantyDocumentNumberTx(tx, { tenantId, createdAt }) {
  const settingsRaw = await ensureSettingsTx(tx, tenantId);
  const counterRaw = await ensureCounterTx(tx, tenantId);

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
    where: { tenantId: String(tenantId) },
    data: {
      nextWarrantySeq: warrantySeq + 1n,
    },
  });

  return {
    warrantyNumber,
  };
}

async function reserveProformaDocumentNumberTx(tx, { tenantId, createdAt }) {
  const settingsRaw = await ensureSettingsTx(tx, tenantId);
  const counterRaw = await ensureCounterTx(tx, tenantId);

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
    where: { tenantId: String(tenantId) },
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