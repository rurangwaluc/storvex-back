"use strict";

const prisma = require("../../config/database");
const { renderReceiptHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");


function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function getTenantId(req) {
  return req.user?.tenantId || null;
}

async function getSignedLogoUrl(tenant) {
  if (!tenant?.logoKey) return null;

  try {
    const { signGetUrl } = require("../../utils/r2");
    return await signGetUrl(tenant.logoKey, 300);
  } catch (err) {
    console.error("signGetUrl failed:", err?.message || err);
    return null;
  }
}

function mapReceiptItem(item) {
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.price || 0);

  return {
    saleItemId: item?.id || null,
    productId: item?.productId || null,
    productName: item?.product?.name || null,
    sku: item?.product?.sku || null,
    barcode: item?.product?.barcode || null,
    serial: item?.product?.serial || null,
    quantity,
    price,
    subtotal: quantity * price,
  };
}

function mapReceiptPayload(sale) {
  const items = Array.isArray(sale?.items) ? sale.items.map(mapReceiptItem) : [];

  return {
    id: sale.id,
    saleId: sale.id,
    number: sale.receiptNumber || null,
    invoiceNumber: sale.invoiceNumber || null,
    date: sale.createdAt || null,
    createdAt: sale.createdAt || null,

    saleType: sale.saleType || null,
    status: sale.status || null,
    total: Number(sale.total || 0),
    subtotal: items.reduce((sum, it) => sum + Number(it.subtotal || 0), 0),
    amountPaid: Number(sale.amountPaid || 0),
    balanceDue: Number(sale.balanceDue || 0),
    refundedTotal: Number(sale.refundedTotal || 0),
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
          tinNumber: sale.customer.tinNumber || null,
          idNumber: sale.customer.idNumber || null,
          notes: sale.customer.notes || null,
        }
      : null,

    store: {
      name: sale.tenant?.name || null,
      phone: sale.tenant?.phone || null,
      email: sale.tenant?.email || null,
      logoUrl: sale.tenant?.logoSignedUrl || null,
      receiptHeader: sale.tenant?.receiptHeader || null,
      receiptFooter: sale.tenant?.receiptFooter || null,
    },

    items,

    payments: Array.isArray(sale.payments)
      ? sale.payments.map((p) => ({
          id: p.id || null,
          amount: Number(p.amount || 0),
          method: p.method || null,
          createdAt: p.createdAt || null,
          note: p.note || null,
        }))
      : [],

    refunds: Array.isArray(sale.refunds)
      ? sale.refunds.map((r) => ({
          id: r.id || null,
          total: Number(r.total || 0),
          method: r.method || null,
          reason: r.reason || null,
          note: r.note || null,
          createdAt: r.createdAt || null,
        }))
      : [],

    warranties: Array.isArray(sale.warranties)
      ? sale.warranties.map((w) => ({
          id: w.id || null,
          warrantyNumber: w.warrantyNumber || null,
          policy: w.policy || null,
          startsAt: w.startsAt || null,
          endsAt: w.endsAt || null,
          durationMonths: w.durationMonths || null,
          durationDays: w.durationDays || null,
          units: Array.isArray(w.units)
            ? w.units.map((u) => ({
                id: u.id || null,
                saleItemId: u.saleItemId || null,
                productId: u.productId || null,
                serial: u.serial || null,
                imei1: u.imei1 || null,
                imei2: u.imei2 || null,
                unitLabel: u.unitLabel || null,
                startsAt: u.startsAt || null,
                endsAt: u.endsAt || null,
              }))
            : [],
        }))
      : [],
  };
}

async function findReceiptSale(tenantId, idOrNumber) {
  const key = cleanString(idOrNumber);
  if (!tenantId || !key) return null;

  const sale = await prisma.sale.findFirst({
    where: {
      tenantId,
      OR: [{ id: key }, { receiptNumber: key }, { invoiceNumber: key }],
    },
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      total: true,
      amountPaid: true,
      balanceDue: true,
      refundedTotal: true,
      saleType: true,
      status: true,
      dueDate: true,
      receiptNumber: true,
      invoiceNumber: true,
      isCancelled: true,
      cancelledAt: true,
      cancelNote: true,

      tenant: {
        select: {
          name: true,
          phone: true,
          email: true,
          logoKey: true,
          receiptHeader: true,
          receiptFooter: true,
        },
      },

      cashier: {
        select: {
          name: true,
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
        orderBy: { id: "asc" },
        select: {
          id: true,
          productId: true,
          quantity: true,
          price: true,
          product: {
            select: {
              name: true,
              sku: true,
              barcode: true,
              ...(typeof prisma.product.fields?.serial !== "undefined" ? { serial: true } : {}),
            },
          },
        },
      },

      payments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amount: true,
          method: true,
          createdAt: true,
          note: true,
        },
      },

      refunds: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          total: true,
          method: true,
          reason: true,
          note: true,
          createdAt: true,
        },
      },

      warranties: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          warrantyNumber: true,
          policy: true,
          startsAt: true,
          endsAt: true,
          durationMonths: true,
          durationDays: true,
          units: {
            orderBy: { createdAt: "asc" },
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
            },
          },
        },
      },
    },
  });

  if (!sale) return null;

  sale.tenant.logoSignedUrl = await getSignedLogoUrl(sale.tenant);
  return sale;
}

// -----------------------
// GET /api/receipts
// -----------------------
async function listReceipts(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const q = cleanString(req.query.q);

    const where = { tenantId };

    if (q) {
      where.OR = [
        { id: keyOrSelf(q) },
        { receiptNumber: { contains: q, mode: "insensitive" } },
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { customer: { phone: { contains: q, mode: "insensitive" } } },
        { cashier: { name: { contains: q, mode: "insensitive" } } },
      ];
    }

    const sales = await prisma.sale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        refundedTotal: true,
        saleType: true,
        status: true,
        isCancelled: true,
        customer: {
          select: {
            name: true,
            phone: true,
          },
        },
        cashier: {
          select: {
            name: true,
          },
        },
      },
    });

    const receipts = sales.map((sale) => ({
      id: sale.id,
      number: sale.receiptNumber || null,
      invoiceNumber: sale.invoiceNumber || null,
      date: sale.createdAt || null,
      createdAt: sale.createdAt || null,
      customerName: sale.customer?.name || null,
      customerPhone: sale.customer?.phone || null,
      cashierName: sale.cashier?.name || null,
      total: Number(sale.total || 0),
      amountPaid: Number(sale.amountPaid || 0),
      balanceDue: Number(sale.balanceDue || 0),
      refundedTotal: Number(sale.refundedTotal || 0),
      saleType: sale.saleType || null,
      status: sale.status || null,
      isCancelled: Boolean(sale.isCancelled),
    }));

    return res.json({
      receipts,
      count: receipts.length,
    });
  } catch (err) {
    console.error("listReceipts error:", err);
    return res.status(500).json({ message: "Failed to load receipts" });
  }
}

// helper only to keep OR array valid
function keyOrSelf(v) {
  return v;
}

// -----------------------
// GET /api/receipts/:id
// -----------------------
async function getReceipt(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const key = String(req.params.id || "").trim();
    if (!key) {
      return res.status(400).json({ message: "Receipt id is required" });
    }

    const sale = await findReceiptSale(tenantId, key);

    if (!sale) {
      return res.status(404).json({ message: "Receipt not found" });
    }

    return res.json({
      receipt: mapReceiptPayload(sale),
    });
  } catch (err) {
    console.error("getReceipt error:", err);
    return res.status(500).json({ message: "Failed to fetch receipt" });
  }
}

// -----------------------
// GET /api/receipts/:id/print
// -----------------------
async function printReceiptHtml(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).send("Unauthorized");

    const key = String(req.params.id || "").trim();
    if (!key) return res.status(400).send("Receipt id is required");

    const sale = await findReceiptSale(tenantId, key);
    if (!sale) return res.status(404).send("Receipt not found");

    const payload = mapReceiptPayload(sale);

    const branding = await buildTenantDocumentBranding(prisma, tenantId);

    const html = renderReceiptHtml({
        tenant: {
                name: branding?.name || payload.store?.name || null,
                phone: branding?.phone || payload.store?.phone || null,
                email: branding?.email || payload.store?.email || null,
                logoSignedUrl: branding?.logoSignedUrl || null,
                receiptHeader: branding?.receiptHeader || payload.store?.receiptHeader || null,
                receiptFooter: branding?.receiptFooter || payload.store?.receiptFooter || null,
                documentPrimaryColor: branding?.documentPrimaryColor || "#0F4C81",
                documentAccentColor: branding?.documentAccentColor || "#E8EEF5",
                invoiceTerms: branding?.invoiceTerms || null,
                warrantyTerms: branding?.warrantyTerms || null,
                proformaTerms: branding?.proformaTerms || null,
                deliveryNoteTerms: branding?.deliveryNoteTerms || null,
              },
      document: {
        number: payload.number,
        date: payload.date,
      },
      customer: {
        name: payload.customer?.name || "Walk-in Customer",
        phone: payload.customer?.phone || null,
        address: payload.customer?.address || null,
      },
      items: payload.items.map((it) => ({
        productName: it.productName,
        serial: it.serial,
        quantity: it.quantity,
        price: it.price,
        total: it.subtotal,
      })),
      totals: {
        subtotal: payload.subtotal,
        total: payload.total,
        amountPaid: payload.amountPaid,
        balanceDue: payload.balanceDue,
        currency: "RWF",
      },
      extra: {
        cashier: payload.cashierName,
        saleType: payload.saleType,
        status: payload.status,
        notes: payload.isCancelled
          ? `This receipt was cancelled.${payload.cancelNote ? ` Note: ${payload.cancelNote}` : ""}`
          : "Keep this receipt for support and warranty.",
      },
    });
    

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("printReceiptHtml error:", err);
    return res.status(500).send("Failed to render receipt");
  }
}

module.exports = {
  listReceipts,
  getReceipt,
  printReceiptHtml,
};