"use strict";

const { signGetUrl } = require("../../utils/r2");

function hasField(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

async function buildTenantDocumentBranding(prisma, tenantId) {
  const documentSettingsSelect = {
    invoiceTerms: true,
    warrantyTerms: true,
    ...(hasField(prisma.tenantDocumentSettings, "proformaTerms") ? { proformaTerms: true } : {}),
    ...(hasField(prisma.tenantDocumentSettings, "deliveryNoteTerms")
      ? { deliveryNoteTerms: true }
      : {}),
    ...(hasField(prisma.tenantDocumentSettings, "documentPrimaryColor")
      ? { documentPrimaryColor: true }
      : {}),
    ...(hasField(prisma.tenantDocumentSettings, "documentAccentColor")
      ? { documentAccentColor: true }
      : {}),
  };

  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      logoUrl: true,
      logoKey: true,
      receiptHeader: true,
      receiptFooter: true,
      documentSettings: {
        select: documentSettingsSelect,
      },
    },
  });

  if (!tenant) return null;

  let logoSignedUrl = null;

  if (tenant.logoKey) {
    try {
      logoSignedUrl = await signGetUrl(tenant.logoKey, 300);
    } catch (e) {
      console.error("signGetUrl failed:", e?.message || e);
    }
  }

  return {
    id: tenant.id,
    name: tenant.name || null,
    phone: tenant.phone || null,
    email: tenant.email || null,
    logoUrl: tenant.logoUrl || null,
    logoKey: tenant.logoKey || null,
    logoSignedUrl: logoSignedUrl || tenant.logoUrl || null,
    receiptHeader: tenant.receiptHeader || null,
    receiptFooter: tenant.receiptFooter || null,

    documentPrimaryColor: tenant.documentSettings?.documentPrimaryColor || "#0F4C81",
    documentAccentColor: tenant.documentSettings?.documentAccentColor || "#E8EEF5",

    invoiceTerms: tenant.documentSettings?.invoiceTerms || null,
    warrantyTerms: tenant.documentSettings?.warrantyTerms || null,
    proformaTerms: tenant.documentSettings?.proformaTerms || null,
    deliveryNoteTerms: tenant.documentSettings?.deliveryNoteTerms || null,
  };
}

module.exports = {
  buildTenantDocumentBranding,
};