"use strict";

const prisma = require("../../config/database");
const { renderProformaHtml } = require("../documents/documentRender.service");
const { reserveProformaDocumentNumberTx } = require("../documents/documentNumber.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function cleanString(x) {
  const s = String(x ?? "").trim();
  return s || null;
}

function toInt(x, fallback = NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function toNumber(x, fallback = NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(x) {
  const v = String(x || "").trim().toUpperCase();
  if (["DRAFT", "SENT", "EXPIRED", "CONVERTED", "CANCELLED"].includes(v)) return v;
  return null;
}

function resolveProformaBranchScope(req) {
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
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
      throw e;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(requestedBranchId)) {
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
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

function applyProformaBranchScope(where, scope) {
  const next = { ...(where || {}) };

  if (
    scope?.mode === "SINGLE_BRANCH" &&
    scope?.branchId &&
    typeof prisma.proforma.fields?.branchId !== "undefined"
  ) {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    const e = new Error("BRANCH_REQUIRED");
    e.code = "BRANCH_REQUIRED";
    throw e;
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(branchId)) {
    const e = new Error("BRANCH_ACCESS_DENIED");
    e.code = "BRANCH_ACCESS_DENIED";
    throw e;
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
    const e = new Error("BRANCH_NOT_FOUND");
    e.code = "BRANCH_NOT_FOUND";
    throw e;
  }

  if (branch.status !== "ACTIVE") {
    const e = new Error("BRANCH_NOT_ACTIVE");
    e.code = "BRANCH_NOT_ACTIVE";
    throw e;
  }

  return branch;
}

function mapProformaListRow(p) {
  return {
    id: p.id,
    branchId: p.branchId || null,
    branch: p.branch || null,
    number: p.number,
    status: p.status,
    customerName: p.customerName,
    customerPhone: p.customerPhone,
    customerEmail: p.customerEmail,
    total: Number(p.total || 0),
    subtotal: Number(p.subtotal || 0),
    currency: p.currency || "RWF",
    validUntil: p.validUntil || null,
    preparedBy: p.preparedBy || null,
    reference: p.reference || null,
    convertedToSaleId: p.convertedToSaleId || null,
    convertedAt: p.convertedAt || null,
    itemsCount: Array.isArray(p.items) ? p.items.length : 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function mapProformaDetail(p, tenant) {
  return {
    proforma: {
      id: p.id,
      branchId: p.branchId || null,
      branch: p.branch
        ? {
            id: p.branch.id || null,
            name: p.branch.name || null,
            code: p.branch.code || null,
            status: p.branch.status || null,
            isMain: Boolean(p.branch.isMain),
          }
        : null,
      number: p.number,
      status: p.status,
      tenantId: p.tenantId,
      customerId: p.customerId || null,
      createdById: p.createdById || null,

      customerName: p.customerName,
      customerPhone: p.customerPhone || null,
      customerEmail: p.customerEmail || null,
      customerAddress: p.customerAddress || null,

      subtotal: Number(p.subtotal || 0),
      total: Number(p.total || 0),
      currency: p.currency || "RWF",

      validUntil: p.validUntil || null,
      preparedBy: p.preparedBy || null,
      reference: p.reference || null,
      notes: p.notes || null,

      convertedToSaleId: p.convertedToSaleId || null,
      convertedAt: p.convertedAt || null,

      createdAt: p.createdAt,
      updatedAt: p.updatedAt,

      customer: p.customer
        ? {
            id: p.customer.id,
            name: p.customer.name,
            phone: p.customer.phone,
            email: p.customer.email || null,
            address: p.customer.address || null,
            tinNumber: p.customer.tinNumber || null,
            idNumber: p.customer.idNumber || null,
            notes: p.customer.notes || null,
          }
        : null,

      createdBy: p.createdBy
        ? {
            id: p.createdBy.id,
            name: p.createdBy.name || null,
            email: p.createdBy.email || null,
            phone: p.createdBy.phone || null,
            role: p.createdBy.role || null,
          }
        : null,

      store: tenant
        ? {
            name: tenant.name || null,
            phone: tenant.phone || null,
            email: tenant.email || null,
            logoUrl: tenant.logoUrl || null,
            logoSignedUrl: tenant.logoSignedUrl || null,
            receiptHeader: tenant.receiptHeader || null,
            receiptFooter: tenant.receiptFooter || null,
            branchName: tenant.branchName || p.branch?.name || null,
            branchCode: tenant.branchCode || p.branch?.code || null,
          }
        : null,

      items: Array.isArray(p.items)
        ? p.items.map((item) => ({
            id: item.id,
            proformaId: item.proformaId,
            productId: item.productId || null,
            productName: item.productName,
            serial: item.serial || null,
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            total: Number(item.total || 0),
            createdAt: item.createdAt,
            product: item.product
              ? {
                  id: item.product.id,
                  name: item.product.name || null,
                  sku: item.product.sku || null,
                  barcode: item.product.barcode || null,
                  serial: item.product.serial || null,
                }
              : null,
          }))
        : [],
    },
  };
}

// -----------------------
// GET /api/proformas
// -----------------------
async function listProformas(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveProformaBranchScope(req);
    const q = cleanString(req.query.q);
    const status = normalizeStatus(req.query.status);

    const where = applyProformaBranchScope({ tenantId }, scope);

    if (status) {
      where.status = status;
    }

    if (q) {
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        { number: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q, mode: "insensitive" } },
        { preparedBy: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.proforma.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        ...(typeof prisma.proforma.fields?.branchId !== "undefined" ? { branchId: true } : {}),
        ...(typeof prisma.proforma.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
        number: true,
        status: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        subtotal: true,
        total: true,
        currency: true,
        validUntil: true,
        preparedBy: true,
        reference: true,
        convertedToSaleId: true,
        convertedAt: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: { id: true },
        },
      },
    });

    return res.json({
      proformas: rows.map(mapProformaListRow),
      count: rows.length,
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listProformas error:", err);
    return res.status(500).json({ message: "Failed to load proformas" });
  }
}

// -----------------------
// POST /api/proformas
// -----------------------
async function createProforma(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const activeBranch = await ensureWritableBranchAccessOrThrow(req);

    const {
      customerId,
      customerName,
      customerPhone,
      customerEmail,
      customerAddress,
      validUntil,
      preparedBy,
      reference,
      notes,
      currency,
      items,
      status,
    } = req.body || {};

    const cleanCustomerName = cleanString(customerName);
    if (!cleanCustomerName) {
      return res.status(400).json({ message: "customerName is required" });
    }

    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return res.status(400).json({ message: "items are required" });
    }

    for (const item of list) {
      const productName = cleanString(item.productName);
      const quantity = toInt(item.quantity, NaN);
      const unitPrice = toNumber(item.unitPrice, NaN);

      if (!productName) {
        return res.status(400).json({ message: "Each item must have productName" });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ message: "Each item quantity must be a positive integer" });
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ message: "Each item unitPrice must be a valid number" });
      }
    }

    const parsedValidUntil = validUntil ? new Date(validUntil) : null;
    if (validUntil && Number.isNaN(parsedValidUntil.getTime())) {
      return res.status(400).json({ message: "validUntil is invalid" });
    }

    const finalStatus = normalizeStatus(status) || "DRAFT";
    if (["CONVERTED", "EXPIRED"].includes(finalStatus)) {
      return res.status(400).json({ message: "Cannot create proforma directly in this status" });
    }

    const result = await prisma.$transaction(async (tx) => {
      let customer = null;

      if (customerId) {
        customer = await tx.customer.findFirst({
          where: {
            id: String(customerId),
            tenantId,
          },
          select: { id: true, name: true, phone: true, email: true, address: true },
        });

        if (!customer) {
          throw new Error("CUSTOMER_NOT_FOUND");
        }
      }

      const createdAt = new Date();
      const doc = await reserveProformaDocumentNumberTx(tx, {
        tenantId,
        createdAt,
      });

      const preparedByText =
        cleanString(preparedBy) || req.user?.name || req.user?.email || "Store Staff";

      const itemRows = list.map((item) => {
        const quantity = toInt(item.quantity, 0);
        const unitPrice = toNumber(item.unitPrice, 0);
        return {
          productId: cleanString(item.productId),
          productName: cleanString(item.productName),
          serial: cleanString(item.serial),
          quantity,
          unitPrice,
          total: quantity * unitPrice,
        };
      });

      const subtotal = itemRows.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const total = subtotal;

      const createData = {
        tenantId,
        customerId: customer?.id || cleanString(customerId),
        createdById: userId || null,

        number: doc.proformaNumber,
        status: finalStatus,

        customerName: cleanCustomerName,
        customerPhone: cleanString(customerPhone) || customer?.phone || null,
        customerEmail: cleanString(customerEmail) || customer?.email || null,
        customerAddress: cleanString(customerAddress) || customer?.address || null,

        subtotal,
        total,
        currency: cleanString(currency) || "RWF",

        validUntil: parsedValidUntil,
        preparedBy: preparedByText,
        reference: cleanString(reference),
        notes: cleanString(notes),
      };

      if (typeof tx.proforma.fields?.branchId !== "undefined") {
        createData.branchId = activeBranch.id;
      }

      const proforma = await tx.proforma.create({
        data: createData,
        select: {
          id: true,
          ...(typeof tx.proforma.fields?.branchId !== "undefined" ? { branchId: true } : {}),
          number: true,
          status: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          customerAddress: true,
          subtotal: true,
          total: true,
          currency: true,
          validUntil: true,
          preparedBy: true,
          reference: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await tx.proformaItem.createMany({
        data: itemRows.map((item) => ({
          proformaId: proforma.id,
          productId: item.productId || null,
          productName: item.productName,
          serial: item.serial || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      });

      return {
        ...proforma,
        branchId: proforma.branchId || activeBranch.id,
      };
    });

    return res.status(201).json({
      created: true,
      proforma: result,
    });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (code === "BRANCH_REQUIRED" || msg === "BRANCH_REQUIRED") {
      return res.status(400).json({ message: "No active branch selected", code: "BRANCH_REQUIRED" });
    }
    if (code === "BRANCH_ACCESS_DENIED" || msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied", code: "BRANCH_ACCESS_DENIED" });
    }
    if (code === "BRANCH_NOT_FOUND" || msg === "BRANCH_NOT_FOUND") {
      return res.status(404).json({ message: "Branch not found" });
    }
    if (code === "BRANCH_NOT_ACTIVE" || msg === "BRANCH_NOT_ACTIVE") {
      return res.status(409).json({ message: "Selected branch is not active" });
    }
    if (msg === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }

    console.error("createProforma error:", err);
    return res.status(500).json({ message: "Failed to create proforma" });
  }
}

// -----------------------
// GET /api/proformas/:id
// -----------------------
async function getProforma(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveProformaBranchScope(req);
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Proforma id is required" });

    const proforma = await prisma.proforma.findFirst({
      where: applyProformaBranchScope(
        {
          tenantId,
          OR: [{ id }, { number: id }],
        },
        scope
      ),
      include: {
        ...(typeof prisma.proforma.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            tinNumber: true,
            idNumber: true,
            notes: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        },
        items: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                serial: true,
              },
            },
          },
        },
      },
    });

    if (!proforma) {
      return res.status(404).json({ message: "Proforma not found" });
    }

    const tenant = await buildTenantDocumentBranding(
      prisma,
      tenantId,
      proforma.branchId || null
    );

    return res.json({
      ...mapProformaDetail(proforma, tenant),
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("getProforma error:", err);
    return res.status(500).json({ message: "Failed to load proforma" });
  }
}

// -----------------------
// PATCH /api/proformas/:id
// -----------------------
async function updateProforma(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveProformaBranchScope(req);
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Proforma id is required" });

    const existing = await prisma.proforma.findFirst({
      where: applyProformaBranchScope(
        {
          tenantId,
          OR: [{ id }, { number: id }],
        },
        scope
      ),
      select: {
        id: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Proforma not found" });
    }

    if (existing.status === "CONVERTED" || existing.status === "CANCELLED") {
      return res.status(400).json({ message: "This proforma can no longer be edited" });
    }

    const nextStatus = req.body?.status ? normalizeStatus(req.body.status) : null;
    if (req.body?.status && !nextStatus) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (nextStatus === "CONVERTED") {
      return res.status(400).json({ message: "Use conversion flow to mark proforma as converted" });
    }

    const payloadItems = Array.isArray(req.body?.items) ? req.body.items : null;
    if (payloadItems) {
      if (payloadItems.length === 0) {
        return res.status(400).json({ message: "items cannot be empty" });
      }

      for (const item of payloadItems) {
        const productName = cleanString(item.productName);
        const quantity = toInt(item.quantity, NaN);
        const unitPrice = toNumber(item.unitPrice, NaN);

        if (!productName) {
          return res.status(400).json({ message: "Each item must have productName" });
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          return res.status(400).json({ message: "Each item quantity must be a positive integer" });
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          return res.status(400).json({ message: "Each item unitPrice must be a valid number" });
        }
      }
    }

    const parsedValidUntil =
      req.body?.validUntil === undefined
        ? undefined
        : req.body?.validUntil
        ? new Date(req.body.validUntil)
        : null;

    if (parsedValidUntil !== undefined && parsedValidUntil !== null) {
      if (Number.isNaN(parsedValidUntil.getTime())) {
        return res.status(400).json({ message: "validUntil is invalid" });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      let subtotal;
      let total;

      if (payloadItems) {
        const itemRows = payloadItems.map((item) => {
          const quantity = toInt(item.quantity, 0);
          const unitPrice = toNumber(item.unitPrice, 0);
          return {
            productId: cleanString(item.productId),
            productName: cleanString(item.productName),
            serial: cleanString(item.serial),
            quantity,
            unitPrice,
            total: quantity * unitPrice,
          };
        });

        subtotal = itemRows.reduce((sum, item) => sum + Number(item.total || 0), 0);
        total = subtotal;

        await tx.proformaItem.deleteMany({
          where: { proformaId: existing.id },
        });

        await tx.proformaItem.createMany({
          data: itemRows.map((item) => ({
            proformaId: existing.id,
            productId: item.productId || null,
            productName: item.productName,
            serial: item.serial || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        });
      }

      const updated = await tx.proforma.update({
        where: { id: existing.id },
        data: {
          ...(req.body?.customerName !== undefined
            ? { customerName: cleanString(req.body.customerName) || undefined }
            : {}),
          ...(req.body?.customerPhone !== undefined
            ? { customerPhone: cleanString(req.body.customerPhone) }
            : {}),
          ...(req.body?.customerEmail !== undefined
            ? { customerEmail: cleanString(req.body.customerEmail) }
            : {}),
          ...(req.body?.customerAddress !== undefined
            ? { customerAddress: cleanString(req.body.customerAddress) }
            : {}),
          ...(req.body?.currency !== undefined
            ? { currency: cleanString(req.body.currency) || "RWF" }
            : {}),
          ...(req.body?.preparedBy !== undefined
            ? { preparedBy: cleanString(req.body.preparedBy) }
            : {}),
          ...(req.body?.reference !== undefined
            ? { reference: cleanString(req.body.reference) }
            : {}),
          ...(req.body?.notes !== undefined
            ? { notes: cleanString(req.body.notes) }
            : {}),
          ...(parsedValidUntil !== undefined ? { validUntil: parsedValidUntil } : {}),
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(subtotal !== undefined ? { subtotal } : {}),
          ...(total !== undefined ? { total } : {}),
        },
        select: {
          id: true,
          ...(typeof tx.proforma.fields?.branchId !== "undefined" ? { branchId: true } : {}),
          number: true,
          status: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
          customerAddress: true,
          subtotal: true,
          total: true,
          currency: true,
          validUntil: true,
          preparedBy: true,
          reference: true,
          notes: true,
          convertedToSaleId: true,
          convertedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return updated;
    });

    return res.json({
      updated: true,
      proforma: result,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("updateProforma error:", err);
    return res.status(500).json({ message: "Failed to update proforma" });
  }
}

async function deleteProforma(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveProformaBranchScope(req);
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ message: "Proforma id is required" });

    const existing = await prisma.proforma.findFirst({
      where: applyProformaBranchScope(
        {
          tenantId,
          OR: [{ id }, { number: id }],
        },
        scope
      ),
      select: {
        id: true,
        number: true,
        status: true,
        convertedToSaleId: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Proforma not found" });
    }

    if (existing.status === "CONVERTED" || existing.convertedToSaleId) {
      return res.status(400).json({
        message: "Converted proformas cannot be deleted",
      });
    }

    await prisma.proforma.delete({
      where: { id: existing.id },
    });

    return res.json({
      deleted: true,
      id: existing.id,
      number: existing.number || null,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("deleteProforma error:", err);
    return res.status(500).json({ message: "Failed to delete proforma" });
  }
}

// -----------------------
// GET /api/proformas/:id/print
// -----------------------
async function printProformaHtml(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).send("Unauthorized");

    const scope = resolveProformaBranchScope(req);
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).send("Proforma id is required");

    const proforma = await prisma.proforma.findFirst({
      where: applyProformaBranchScope(
        {
          tenantId,
          OR: [{ id }, { number: id }],
        },
        scope
      ),
      include: {
        ...(typeof prisma.proforma.fields?.branchId !== "undefined"
          ? {
              branch: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  status: true,
                  isMain: true,
                },
              },
            }
          : {}),
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
          },
        },
        items: {
          orderBy: [{ createdAt: "asc" }],
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                serial: true,
              },
            },
          },
        },
      },
    });

    if (!proforma) return res.status(404).send("Proforma not found");

    const tenant = await buildTenantDocumentBranding(
      prisma,
      tenantId,
      proforma.branchId || null
    );

    const html = renderProformaHtml({
      tenant: {
        ...tenant,
        branchName: tenant?.branchName || proforma.branch?.name || null,
        branchCode: tenant?.branchCode || proforma.branch?.code || null,
      },
      document: {
        number: proforma.number,
        date: proforma.createdAt,
        createdAt: proforma.createdAt,
      },
      customer: proforma.customer
        ? {
            name: proforma.customer.name,
            phone: proforma.customer.phone,
            address: proforma.customer.address || proforma.customerAddress || null,
          }
        : {
            name: proforma.customerName,
            phone: proforma.customerPhone,
            address: proforma.customerAddress,
          },
      items: (proforma.items || []).map((item) => ({
        productName: item.productName || item.product?.name || "—",
        serial: item.serial || item.product?.serial || null,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        price: Number(item.unitPrice || 0),
        total: Number(item.total || 0),
      })),
      totals: {
        subtotal: Number(proforma.subtotal || 0),
        total: Number(proforma.total || 0),
        amountPaid: 0,
        balanceDue: Number(proforma.total || 0),
        currency: proforma.currency || "RWF",
      },
      extra: {
        notes: proforma.notes,
        preparedBy: proforma.preparedBy,
        validUntil: proforma.validUntil,
        reference: proforma.reference,
        branchName: proforma.branch?.name || null,
        branchCode: proforma.branch?.code || null,
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).send("Branch access denied");
    }

    console.error("printProformaHtml error:", err);
    return res.status(500).send("Failed to render proforma");
  }
}

module.exports = {
  listProformas,
  createProforma,
  getProforma,
  updateProforma,
  deleteProforma,
  printProformaHtml,
};