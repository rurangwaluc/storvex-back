"use strict";

const prisma = require("../../config/database");
const { renderInvoiceHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function cleanString(x) {
  const s = String(x ?? "").trim();
  return s || null;
}

function toMoneyNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function hasField(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

function saleDraftWhereFalse() {
  return hasField(prisma.sale, "isDraft") ? { isDraft: false } : {};
}

function saleItemsOrderBy() {
  return hasField(prisma.saleItem, "createdAt") ? [{ createdAt: "asc" }] : [{ id: "asc" }];
}

function saleSelect() {
  return {
    id: true,
    ...(hasField(prisma.sale, "invoiceNumber") ? { invoiceNumber: true } : {}),
    ...(hasField(prisma.sale, "receiptNumber") ? { receiptNumber: true } : {}),
    ...(hasField(prisma.sale, "createdAt") ? { createdAt: true } : {}),
    ...(hasField(prisma.sale, "total") ? { total: true } : {}),
    ...(hasField(prisma.sale, "amountPaid") ? { amountPaid: true } : {}),
    ...(hasField(prisma.sale, "balanceDue") ? { balanceDue: true } : {}),
    ...(hasField(prisma.sale, "refundedTotal") ? { refundedTotal: true } : {}),
    ...(hasField(prisma.sale, "saleType") ? { saleType: true } : {}),
    ...(hasField(prisma.sale, "status") ? { status: true } : {}),
    ...(hasField(prisma.sale, "dueDate") ? { dueDate: true } : {}),
    ...(hasField(prisma.sale, "isCancelled") ? { isCancelled: true } : {}),
    ...(hasField(prisma.sale, "cancelledAt") ? { cancelledAt: true } : {}),
    ...(hasField(prisma.sale, "cancelNote") ? { cancelNote: true } : {}),
    cashier: {
      select: {
        ...(hasField(prisma.user, "name") ? { name: true } : {}),
      },
    },
    customer: {
      select: {
        ...(hasField(prisma.customer, "id") ? { id: true } : {}),
        ...(hasField(prisma.customer, "name") ? { name: true } : {}),
        ...(hasField(prisma.customer, "phone") ? { phone: true } : {}),
        ...(hasField(prisma.customer, "email") ? { email: true } : {}),
        ...(hasField(prisma.customer, "address") ? { address: true } : {}),
      },
    },
  };
}

function saleSelectWithItems() {
  return {
    ...saleSelect(),
    items: {
      orderBy: saleItemsOrderBy(),
      select: {
        id: true,
        ...(hasField(prisma.saleItem, "productId") ? { productId: true } : {}),
        ...(hasField(prisma.saleItem, "quantity") ? { quantity: true } : {}),
        ...(hasField(prisma.saleItem, "price") ? { price: true } : {}),
        product: {
          select: {
            ...(hasField(prisma.product, "name") ? { name: true } : {}),
            ...(hasField(prisma.product, "sku") ? { sku: true } : {}),
            ...(hasField(prisma.product, "barcode") ? { barcode: true } : {}),
            ...(hasField(prisma.product, "serial") ? { serial: true } : {}),
          },
        },
      },
    },
  };
}

function mapSaleToInvoiceListRow(sale) {
  return {
    id: sale.id,
    number: sale.invoiceNumber || null,
    receiptNumber: sale.receiptNumber || null,
    date: sale.createdAt || null,
    customerName: sale.customer?.name || "Walk-in Customer",
    customerPhone: sale.customer?.phone || null,
    cashierName: sale.cashier?.name || null,
    total: toMoneyNumber(sale.total),
    amountPaid: toMoneyNumber(sale.amountPaid),
    balanceDue: toMoneyNumber(sale.balanceDue),
    refundedTotal: toMoneyNumber(sale.refundedTotal),
    saleType: sale.saleType || "CASH",
    status: sale.status || null,
    dueDate: sale.dueDate || null,
    isCancelled: Boolean(sale.isCancelled),
    createdAt: sale.createdAt || null,
  };
}

function mapSaleToInvoiceDetail(sale, branding) {
  const items = Array.isArray(sale.items)
    ? sale.items.map((item) => {
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);

        return {
          saleItemId: item.id,
          productId: item.productId,
          productName: item.product?.name || "—",
          sku: item.product?.sku || null,
          barcode: item.product?.barcode || null,
          serial: item.product?.serial || null,
          quantity,
          unitPrice: price,
          price,
          total: quantity * price,
          subtotal: quantity * price,
        };
      })
    : [];

  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

  return {
    invoice: {
      id: sale.id,
      number: sale.invoiceNumber || null,
      receiptNumber: sale.receiptNumber || null,
      date: sale.createdAt || null,
      createdAt: sale.createdAt || null,
      saleType: sale.saleType || "CASH",
      status: sale.status || null,
      total: toMoneyNumber(sale.total),
      subtotal,
      amountPaid: toMoneyNumber(sale.amountPaid),
      balanceDue: toMoneyNumber(sale.balanceDue),
      refundedTotal: toMoneyNumber(sale.refundedTotal),
      dueDate: sale.dueDate || null,
      isCancelled: Boolean(sale.isCancelled),
      cancelledAt: sale.cancelledAt || null,
      cancelNote: sale.cancelNote || null,
      cashierName: sale.cashier?.name || null,
      customer: sale.customer
        ? {
            id: sale.customer.id || null,
            name: sale.customer.name || null,
            phone: sale.customer.phone || null,
            email: sale.customer.email || null,
            address: sale.customer.address || null,
          }
        : null,
      items,
      store: branding
        ? {
            name: branding.name || null,
            email: branding.email || null,
            phone: branding.phone || null,
            logoUrl: branding.logoUrl || null,
            logoSignedUrl: branding.logoSignedUrl || null,
            receiptHeader: branding.receiptHeader || null,
            receiptFooter: branding.receiptFooter || null,
            documentPrimaryColor: branding.documentPrimaryColor || "#1F365C",
            documentAccentColor: branding.documentAccentColor || "#D8D2C2",
            invoiceTerms: branding.invoiceTerms || null,
            warrantyTerms: branding.warrantyTerms || null,
            proformaTerms: branding.proformaTerms || null,
            deliveryNoteTerms: branding.deliveryNoteTerms || null,
          }
        : null,
    },
  };
}

async function listInvoices(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const q = cleanString(req.query.q);

    const where = {
      tenantId,
      ...saleDraftWhereFalse(),
    };

    if (q) {
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        ...(hasField(prisma.sale, "invoiceNumber")
          ? [{ invoiceNumber: { contains: q, mode: "insensitive" } }]
          : []),
        ...(hasField(prisma.sale, "receiptNumber")
          ? [{ receiptNumber: { contains: q, mode: "insensitive" } }]
          : []),
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q, mode: "insensitive" } } },
        { cashier: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const rows = await prisma.sale.findMany({
      where,
      orderBy: hasField(prisma.sale, "createdAt") ? [{ createdAt: "desc" }] : [{ id: "desc" }],
      take: 200,
      select: saleSelect(),
    });

    return res.json({
      invoices: rows.map(mapSaleToInvoiceListRow),
      count: rows.length,
    });
  } catch (err) {
    console.error("listInvoices error:", err);
    return res.status(500).json({ message: "Failed to load invoices" });
  }
}

async function getInvoice(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Invoice id is required" });
    }

    const sale = await prisma.sale.findFirst({
      where: {
        tenantId,
        ...saleDraftWhereFalse(),
        OR: [{ id }, ...(hasField(prisma.sale, "invoiceNumber") ? [{ invoiceNumber: id }] : [])],
      },
      select: saleSelectWithItems(),
    });

    if (!sale) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const branding = await buildTenantDocumentBranding(prisma, tenantId);

    return res.json(mapSaleToInvoiceDetail(sale, branding));
  } catch (err) {
    console.error("getInvoice error:", err);
    return res.status(500).json({ message: "Failed to load invoice" });
  }
}

async function printInvoiceHtml(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).send("Unauthorized");
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).send("Invoice id is required");
    }

    const sale = await prisma.sale.findFirst({
      where: {
        tenantId,
        ...saleDraftWhereFalse(),
        OR: [{ id }, ...(hasField(prisma.sale, "invoiceNumber") ? [{ invoiceNumber: id }] : [])],
      },
      select: saleSelectWithItems(),
    });

    if (!sale) {
      return res.status(404).send("Invoice not found");
    }

    const branding = await buildTenantDocumentBranding(prisma, tenantId);

    const items = (sale.items || []).map((item) => {
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price || 0);

      return {
        productName: item.product?.name || "—",
        serial: item.product?.serial || null,
        sku: item.product?.sku || null,
        barcode: item.product?.barcode || null,
        quantity,
        unitPrice: price,
        price,
        total: quantity * price,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);

    const html = renderInvoiceHtml({
      tenant: {
        name: branding?.name || null,
        phone: branding?.phone || null,
        email: branding?.email || null,
        logoUrl: branding?.logoUrl || null,
        logoSignedUrl: branding?.logoSignedUrl || null,
        receiptHeader: branding?.receiptHeader || null,
        receiptFooter: branding?.receiptFooter || null,
        documentPrimaryColor: branding?.documentPrimaryColor || "#1F365C",
        documentAccentColor: branding?.documentAccentColor || "#D8D2C2",
        invoiceTerms: branding?.invoiceTerms || null,
        warrantyTerms: branding?.warrantyTerms || null,
        proformaTerms: branding?.proformaTerms || null,
        deliveryNoteTerms: branding?.deliveryNoteTerms || null,
      },
      document: {
        number: sale.invoiceNumber || sale.id,
        date: sale.createdAt || null,
        createdAt: sale.createdAt || null,
      },
      customer: sale.customer
        ? {
            name: sale.customer.name || "Walk-in Customer",
            phone: sale.customer.phone || null,
            email: sale.customer.email || null,
            address: sale.customer.address || null,
          }
        : {
            name: "Walk-in Customer",
            phone: null,
            email: null,
            address: null,
          },
      items,
      totals: {
        currency: "RWF",
        subtotal,
        total: toMoneyNumber(sale.total),
        amountPaid: toMoneyNumber(sale.amountPaid),
        balanceDue: toMoneyNumber(sale.balanceDue),
      },
      extra: {
        cashier: sale.cashier?.name || "",
        status: sale.status || "INVOICE",
        saleRef: sale.receiptNumber || sale.id,
        dueDate: sale.dueDate || null,
        invoiceTerms: branding?.invoiceTerms || null,
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    console.error("printInvoiceHtml error:", err);
    return res.status(500).send("Failed to render invoice");
  }
}

module.exports = {
  listInvoices,
  getInvoice,
  printInvoiceHtml,
};