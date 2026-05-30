"use strict";

const prisma = require("../../config/database");
const { renderReceiptHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");
const {
  parsePagination,
  buildPaginationMeta,
} = require("../../lib/pagination");

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function resolveReceiptBranchScope(req) {
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
      const e = new Error("LOCATION_ACCESS_DENIED");
      e.code = "LOCATION_ACCESS_DENIED";
      throw e;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (
      !canViewAllBranches(req) &&
      allowedBranchIds.length > 0 &&
      !allowedBranchIds.includes(requestedBranchId)
    ) {
      const e = new Error("LOCATION_ACCESS_DENIED");
      e.code = "LOCATION_ACCESS_DENIED";
      throw e;
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

function applyReceiptBranchScope(where, scope) {
  const next = { ...(where || {}) };

  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    next.branchId = scope.branchId;
  }

  return next;
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

function serializeLocation(branch, branding = null) {
  if (branding) {
    return {
      name:
        branding.sellingLocation ||
        branding.storeLocation ||
        branding.locationName ||
        branch?.name ||
        "Store location",
      code: branding.locationCode || branch?.code || null,
      status: branding.locationStatus || branch?.status || null,
      isMain: Boolean(branding.isMainLocation || branch?.isMain),
      address: branding.locationAddress || null,
      phone: branding.locationPhone || null,
      email: branding.locationEmail || null,
    };
  }

  return branch
    ? {
        name: branch.name || "Store location",
        code: branch.code || null,
        status: branch.status || null,
        isMain: Boolean(branch.isMain),
        address: null,
        phone: null,
        email: null,
      }
    : null;
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

function mapReceiptPayload(sale, branding = null) {
  const items = Array.isArray(sale?.items) ? sale.items.map(mapReceiptItem) : [];
  const location = serializeLocation(sale.branch, branding);

  return {
    id: sale.id,
    saleId: sale.id,
    branchId: sale.branchId || null,
    location,
    number: sale.receiptNumber || null,
    invoiceNumber: sale.invoiceNumber || null,
    date: sale.createdAt || null,
    createdAt: sale.createdAt || null,

    saleType: sale.saleType || null,
    status: sale.status || null,

    subtotalAmount: Number(sale.subtotalAmount ?? 0),
    taxableAmount: Number(sale.taxableAmount ?? 0),
    taxName: sale.taxName || null,
    taxMode: sale.taxMode || "NONE",
    taxDisplayMode: sale.taxDisplayMode || "HIDDEN",
    taxRateBps: Number(sale.taxRateBps ?? 0),
    taxAmount: Number(sale.taxAmount ?? 0),
    pricesIncludeTax: Boolean(sale.pricesIncludeTax),
    showTaxOnCustomerDocuments: Boolean(sale.showTaxOnCustomerDocuments),

    total: Number(sale.total || 0),
    subtotal: Number(
      sale.subtotalAmount ??
        items.reduce((sum, it) => sum + Number(it.subtotal || 0), 0)
    ),
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
      name: branding?.name || sale.tenant?.name || null,
      phone: branding?.phone || sale.tenant?.phone || null,
      email: branding?.email || sale.tenant?.email || null,
      logoUrl: branding?.logoSignedUrl || branding?.logoUrl || sale.tenant?.logoSignedUrl || null,
      receiptHeader: branding?.receiptHeader || sale.tenant?.receiptHeader || null,
      receiptFooter: branding?.receiptFooter || sale.tenant?.receiptFooter || null,
      documentPrimaryColor: branding?.documentPrimaryColor || "#0F4C81",
      documentAccentColor: branding?.documentAccentColor || "#E8EEF5",
      documentHeaderDisplay: branding?.documentHeaderDisplay || "LOGO_AND_NAME",
      documentSizeMode: branding?.documentSizeMode || "AUTO",
      locationName: location?.name || null,
      locationCode: location?.code || null,
      locationAddress: location?.address || null,
      sellingLocation: location?.name || null,
      storeLocation: location?.name || null,
    },

    items,

    payments: Array.isArray(sale.payments)
      ? sale.payments.map((p) => ({
          id: p.id || null,
          amount: Number(p.amount || 0),
          method: p.method || null,
          createdAt: p.createdAt || null,
          note: p.note || null,
          branchId: p.branchId || null,
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
          branchId: r.branchId || null,
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
          branchId: w.branchId || null,
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

async function findReceiptSale(tenantId, idOrNumber, scope = null) {
  const key = cleanString(idOrNumber);
  if (!tenantId || !key) return null;

  const sale = await prisma.sale.findFirst({
    where: applyReceiptBranchScope(
      {
        tenantId,
        OR: [{ id: key }, { receiptNumber: key }, { invoiceNumber: key }],
      },
      scope
    ),
    select: {
      id: true,
      tenantId: true,
      branchId: true,
      createdAt: true,
      total: true,
      subtotalAmount: true,
      taxableAmount: true,
      taxName: true,
      taxMode: true,
      taxDisplayMode: true,
      taxRateBps: true,
      taxAmount: true,
      pricesIncludeTax: true,
      showTaxOnCustomerDocuments: true,
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

      branch: {
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          isMain: true,
        },
      },

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
          ...(typeof prisma.salePayment.fields?.branchId !== "undefined" ? { branchId: true } : {}),
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
          ...(typeof prisma.saleRefund.fields?.branchId !== "undefined" ? { branchId: true } : {}),
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
          ...(typeof prisma.saleWarranty.fields?.branchId !== "undefined" ? { branchId: true } : {}),
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

function keyOrSelf(v) {
  return v;
}

async function listReceipts(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveReceiptBranchScope(req);
    const q = cleanString(req.query.q);

    const pagination = parsePagination(req.query, {
        defaultLimit: 30,
        maxLimit: 100,
      });

    const where = applyReceiptBranchScope({ tenantId }, scope);

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

    const [total, sales] = await prisma.$transaction([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        branchId: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        total: true,
        subtotalAmount: true,
        taxableAmount: true,
        taxName: true,
        taxMode: true,
        taxDisplayMode: true,
        taxRateBps: true,
        taxAmount: true,
        pricesIncludeTax: true,
        showTaxOnCustomerDocuments: true,
        amountPaid: true,
        balanceDue: true,
        refundedTotal: true,
        saleType: true,
        status: true,
        isCancelled: true,
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
      }),
    ]);

    const receipts = sales.map((sale) => ({
      id: sale.id,
      branchId: sale.branchId || null,
      location: serializeLocation(sale.branch),
      number: sale.receiptNumber || null,
      invoiceNumber: sale.invoiceNumber || null,
      date: sale.createdAt || null,
      createdAt: sale.createdAt || null,
      customerName: sale.customer?.name || null,
      customerPhone: sale.customer?.phone || null,
      cashierName: sale.cashier?.name || null,
      total: Number(sale.total || 0),
      subtotalAmount: Number(sale.subtotalAmount ?? 0),
      taxableAmount: Number(sale.taxableAmount ?? 0),
      taxName: sale.taxName || null,
      taxMode: sale.taxMode || "NONE",
      taxDisplayMode: sale.taxDisplayMode || "HIDDEN",
      taxRateBps: Number(sale.taxRateBps ?? 0),
      taxAmount: Number(sale.taxAmount ?? 0),
      pricesIncludeTax: Boolean(sale.pricesIncludeTax),
      showTaxOnCustomerDocuments: Boolean(sale.showTaxOnCustomerDocuments),
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
      pagination: buildPaginationMeta({
        page: pagination.page,
        limit: pagination.limit,
        total,
      }),
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "LOCATION_ACCESS_DENIED") {
      return res.status(403).json({ message: "You cannot view documents from this store location." });
    }

    console.error("listReceipts error:", err);
    return res.status(500).json({ message: "Failed to load receipts" });
  }
}

async function getReceipt(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveReceiptBranchScope(req);
    const key = String(req.params.id || "").trim();

    if (!key) {
      return res.status(400).json({ message: "Receipt reference is required" });
    }

    const sale = await findReceiptSale(tenantId, key, scope);

    if (!sale) {
      return res.status(404).json({ message: "Receipt not found" });
    }

    const branding = await buildTenantDocumentBranding(prisma, tenantId, sale.branchId || null);

    return res.json({
      receipt: mapReceiptPayload(sale, branding),
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "LOCATION_ACCESS_DENIED") {
      return res.status(403).json({ message: "You cannot view documents from this store location." });
    }

    console.error("getReceipt error:", err);
    return res.status(500).json({ message: "Failed to fetch receipt" });
  }
}

async function printReceiptHtml(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).send("Unauthorized");

    const scope = resolveReceiptBranchScope(req);
    const key = String(req.params.id || "").trim();

    if (!key) return res.status(400).send("Receipt reference is required");

    const sale = await findReceiptSale(tenantId, key, scope);
    if (!sale) return res.status(404).send("Receipt not found");

    const branding = await buildTenantDocumentBranding(prisma, tenantId, sale.branchId || null);
    const payload = mapReceiptPayload(sale, branding);

    const sellingLocation =
      branding?.sellingLocation ||
      branding?.storeLocation ||
      branding?.locationName ||
      payload.location?.name ||
      null;

    const html = renderReceiptHtml({
      tenant: {
        name: branding?.name || payload.store?.name || null,
        phone: branding?.phone || payload.store?.phone || null,
        email: branding?.email || payload.store?.email || null,
        logoSignedUrl: branding?.logoSignedUrl || payload.store?.logoUrl || null,
        receiptHeader: branding?.receiptHeader || payload.store?.receiptHeader || null,
        receiptFooter: branding?.receiptFooter || payload.store?.receiptFooter || null,
        documentPrimaryColor: branding?.documentPrimaryColor || "#0F4C81",
        documentAccentColor: branding?.documentAccentColor || "#E8EEF5",
        documentHeaderDisplay: branding?.documentHeaderDisplay || "LOGO_AND_NAME",
        documentSizeMode: branding?.documentSizeMode || "AUTO",
        invoiceTerms: branding?.invoiceTerms || null,
        warrantyTerms: branding?.warrantyTerms || null,
        proformaTerms: branding?.proformaTerms || null,
        deliveryNoteTerms: branding?.deliveryNoteTerms || null,
        locationName: sellingLocation,
        locationCode: branding?.locationCode || payload.location?.code || null,
        locationAddress: branding?.locationAddress || payload.location?.address || null,
        sellingLocation,
        storeLocation: branding?.storeLocation || sellingLocation,
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
        currency: "RWF",
        subtotalAmount: payload.subtotalAmount,
        taxableAmount: payload.taxableAmount,
        taxName: payload.taxName,
        taxMode: payload.taxMode,
        taxDisplayMode: payload.taxDisplayMode,
        taxRateBps: payload.taxRateBps,
        taxAmount: payload.taxAmount,
        pricesIncludeTax: payload.pricesIncludeTax,
        showTaxOnCustomerDocuments: payload.showTaxOnCustomerDocuments,
        subtotal: payload.subtotal,
        total: payload.total,
        amountPaid: payload.amountPaid,
        balanceDue: payload.balanceDue,
      },
      extra: {
        cashier: payload.cashierName,
        saleType: payload.saleType,
        status: payload.status,
        isCancelled: Boolean(payload.isCancelled),
        sellingLocation,
        storeLocation: branding?.storeLocation || sellingLocation,
        locationLabel: "Selling location",
        notes: payload.isCancelled
          ? `This receipt was cancelled.${payload.cancelNote ? ` Note: ${payload.cancelNote}` : ""}`
          : "Keep this receipt for support and warranty.",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    if (String(err?.code || err?.message || "") === "LOCATION_ACCESS_DENIED") {
      return res.status(403).send("You cannot view documents from this store location.");
    }

    console.error("printReceiptHtml error:", err);
    return res.status(500).send("Failed to render receipt");
  }
}

module.exports = {
  listReceipts,
  getReceipt,
  printReceiptHtml,
};