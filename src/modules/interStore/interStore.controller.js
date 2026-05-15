// backend/src/modules/interstore/interStore.controller.js
const {
  InterStoreDealStatus,
  AuditAction,
  InterStorePaymentMethod,
} = require("@prisma/client");

const prisma = require("../../config/database");
const logAudit = require("../../utils/auditLogger");

const ALLOWED_INTERSTORE_METHODS = new Set(Object.values(InterStorePaymentMethod));
const ALLOWED_COLLECTION_STATUSES = new Set(Object.values(InterStoreDealStatus));

const WRITABLE_BRANCH_STATUSES = new Set(["ACTIVE"]);
const READABLE_BRANCH_STATUSES = new Set(["ACTIVE", "CLOSED"]);

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function cleanNullableString(value, maxLen = null) {
  const s = cleanString(value);
  if (!s) return null;
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function normalizePhone(value) {
  const s = cleanString(value);
  if (!s) return null;
  return s.replace(/[^\d+]/g, "") || null;
}

function normalizeSerial(value) {
  const s = cleanString(value);
  if (!s) return null;
  return s.toUpperCase();
}

function normalizeInterStoreMethod(method) {
  const m = method ? String(method).trim().toUpperCase() : "CASH";
  return ALLOWED_INTERSTORE_METHODS.has(m) ? m : null;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function toInt(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;
  return Math.floor(n);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseIsoDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function getTenantId(req) {
  return cleanString(req.user?.tenantId || req.tenantId);
}

function getActorUserId(req) {
  return cleanString(req.user?.userId || req.user?.id);
}

function getActiveBranchId(req) {
  return cleanString(
    req.user?.activeBranchId ||
      req.user?.branchId ||
      req.branch?.id ||
      req.headers?.["x-branch-id"]
  );
}

function getAllowedBranchIds(req) {
  if (Array.isArray(req.user?.allowedBranchIds)) {
    return req.user.allowedBranchIds.map(cleanString).filter(Boolean);
  }

  if (Array.isArray(req.user?.visibleBranchIds)) {
    return req.user.visibleBranchIds.map(cleanString).filter(Boolean);
  }

  return [];
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches || req.user?.role === "OWNER");
}

function makeAppError(code, message = code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function serializeBranch(branch) {
  if (!branch) return null;

  return {
    id: branch.id,
    tenantId: branch.tenantId,
    name: branch.name || "",
    code: branch.code || "",
    type: branch.type || "",
    status: branch.status || "",
    phone: branch.phone || null,
    email: branch.email || null,
    district: branch.district || null,
    sector: branch.sector || null,
    address: branch.address || null,
    isMain: Boolean(branch.isMain),
  };
}

function branchSelect() {
  return {
    id: true,
    tenantId: true,
    name: true,
    code: true,
    type: true,
    status: true,
    phone: true,
    email: true,
    district: true,
    sector: true,
    address: true,
    isMain: true,
  };
}

function dealInclude() {
  return {
    borrowerBranch: {
      select: branchSelect(),
    },
  };
}

function paymentInclude() {
  return {
    deal: {
      select: {
        id: true,
        borrowerTenantId: true,
        supplierTenantId: true,
        borrowerBranchId: true,
        status: true,
        productName: true,
        serial: true,
        resellerName: true,
        resellerPhone: true,
        agreedPrice: true,
        soldQuantity: true,
        dueDate: true,
        paidAmount: true,
        borrowerBranch: {
          select: branchSelect(),
        },
      },
    },
    branch: {
      select: branchSelect(),
    },
  };
}

function serializeDeal(deal) {
  if (!deal) return null;

  const branch = deal.borrowerBranch ? serializeBranch(deal.borrowerBranch) : null;

  return {
    ...deal,
    borrowerBranch: branch,
    branch,
    borrowedAt: toIsoOrNull(deal.borrowedAt),
    dueDate: toIsoOrNull(deal.dueDate),
    takenAt: toIsoOrNull(deal.takenAt),
    receivedAt: toIsoOrNull(deal.receivedAt),
    soldAt: toIsoOrNull(deal.soldAt),
    returnedAt: toIsoOrNull(deal.returnedAt),
    paidAt: toIsoOrNull(deal.paidAt),
    createdAt: toIsoOrNull(deal.createdAt),
    updatedAt: toIsoOrNull(deal.updatedAt),
    agreedPrice: Number.isFinite(Number(deal.agreedPrice))
      ? Number(deal.agreedPrice)
      : deal.agreedPrice,
    soldPrice: Number.isFinite(Number(deal.soldPrice)) ? Number(deal.soldPrice) : deal.soldPrice,
    paidAmount: Number.isFinite(Number(deal.paidAmount))
      ? Number(deal.paidAmount)
      : deal.paidAmount,
  };
}

function serializePayment(payment) {
  if (!payment) return null;

  return {
    ...payment,
    amount: Number.isFinite(Number(payment.amount)) ? Number(payment.amount) : payment.amount,
    createdAt: toIsoOrNull(payment.createdAt),
    branch: payment.branch ? serializeBranch(payment.branch) : null,
    deal: payment.deal
      ? {
          ...payment.deal,
          borrowerBranch: payment.deal.borrowerBranch
            ? serializeBranch(payment.deal.borrowerBranch)
            : null,
        }
      : undefined,
  };
}

function dealSuccess(res, deal, extra = {}) {
  return res.json({
    ok: true,
    deal: serializeDeal(deal),
    ...extra,
  });
}

function dealsListSuccess(res, deals, extra = {}) {
  return res.json({
    ok: true,
    deals: Array.isArray(deals) ? deals.map(serializeDeal) : [],
    count: Array.isArray(deals) ? deals.length : 0,
    ...extra,
  });
}

function paymentsListSuccess(res, payments, extra = {}) {
  return res.json({
    ok: true,
    payments: Array.isArray(payments) ? payments.map(serializePayment) : [],
    count: Array.isArray(payments) ? payments.length : 0,
    ...extra,
  });
}

async function getBranchOrThrow({ tenantId, branchId, writable = false }) {
  if (!tenantId || !branchId) {
    throw makeAppError("BRANCH_REQUIRED", "No active branch selected", 400);
  }

  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      tenantId,
      status: {
        in: writable ? Array.from(WRITABLE_BRANCH_STATUSES) : Array.from(READABLE_BRANCH_STATUSES),
      },
    },
    select: branchSelect(),
  });

  if (!branch) {
    throw makeAppError("BRANCH_NOT_FOUND", "Branch not found", 404);
  }

  if (writable && branch.status !== "ACTIVE") {
    throw makeAppError("BRANCH_NOT_ACTIVE", "Selected branch is not active", 409);
  }

  return branch;
}

async function ensureReadableBranchAccessOrThrow(req, requestedBranchId = null) {
  const tenantId = getTenantId(req);
  const allowedBranchIds = getAllowedBranchIds(req);
  const requested = cleanString(requestedBranchId);

  if (!tenantId) {
    throw makeAppError("UNAUTHORIZED", "Unauthorized", 401);
  }

  if (!requested) return null;

  if (!canViewAllBranches(req) && !allowedBranchIds.includes(requested)) {
    throw makeAppError("BRANCH_ACCESS_DENIED", "Branch access denied", 403);
  }

  return getBranchOrThrow({
    tenantId,
    branchId: requested,
    writable: false,
  });
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);
  const allowedBranchIds = getAllowedBranchIds(req);

  if (!tenantId || !branchId) {
    throw makeAppError("BRANCH_REQUIRED", "No active branch selected", 400);
  }

  if (!canViewAllBranches(req) && !allowedBranchIds.includes(branchId)) {
    throw makeAppError("BRANCH_ACCESS_DENIED", "Branch access denied", 403);
  }

  return getBranchOrThrow({
    tenantId,
    branchId,
    writable: true,
  });
}

function resolveBorrowerBranchScope(req) {
  const requestedBranchId =
    cleanString(req.query?.branchId) || cleanString(req.headers?.["x-branch-id"]);

  const allBranchesRequested =
    String(req.query?.allBranches || "").trim().toLowerCase() === "true";

  const activeBranchId = getActiveBranchId(req);
  const allowedBranchIds = getAllowedBranchIds(req);
  const ownerCanSeeAll = canViewAllBranches(req);

  if (allBranchesRequested) {
    if (!ownerCanSeeAll) {
      throw makeAppError("BRANCH_ACCESS_DENIED", "Branch access denied", 403);
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
      canViewAllBranches: true,
    };
  }

  if (requestedBranchId) {
    if (!ownerCanSeeAll && !allowedBranchIds.includes(requestedBranchId)) {
      throw makeAppError("BRANCH_ACCESS_DENIED", "Branch access denied", 403);
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      allowedBranchIds,
      canViewAllBranches: ownerCanSeeAll,
    };
  }

  if (ownerCanSeeAll && !activeBranchId) {
    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
      canViewAllBranches: true,
    };
  }

  return {
    mode: "SINGLE_BRANCH",
    branchId: activeBranchId,
    allowedBranchIds,
    canViewAllBranches: ownerCanSeeAll,
  };
}

function borrowerBranchWhereForScope(scope) {
  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    return { borrowerBranchId: scope.branchId };
  }

  if (scope?.mode === "ALL_BRANCHES") {
    return {};
  }

  return { borrowerBranchId: "__NO_BRANCH__" };
}

function withBorrowerBranchScope(where, scope) {
  return {
    ...(where || {}),
    ...borrowerBranchWhereForScope(scope),
  };
}

function buildBorrowerDealWhere(id, tenantId, scope = null) {
  return withBorrowerBranchScope(
    {
      id,
      borrowerTenantId: tenantId,
    },
    scope
  );
}

function buildVisibleDealWhere(id, tenantId, scope = null) {
  const borrowerVisibility = {
    borrowerTenantId: tenantId,
    ...borrowerBranchWhereForScope(scope),
  };

  return {
    id,
    OR: [
      borrowerVisibility,
      {
        supplierTenantId: tenantId,
      },
    ],
  };
}

async function getBorrowerDealOrNull({ id, tenantId, scope = null, tx = prisma }) {
  return tx.interStoreDeal.findFirst({
    where: buildBorrowerDealWhere(id, tenantId, scope),
    include: dealInclude(),
  });
}

async function getVisibleDealOrNull({ id, tenantId, scope = null, tx = prisma }) {
  return tx.interStoreDeal.findFirst({
    where: buildVisibleDealWhere(id, tenantId, scope),
    include: dealInclude(),
  });
}

async function assertBorrowerSerialNotDuplicated({
  tx,
  tenantId,
  branchId,
  serial,
  ignoreDealId = null,
  ignoreProductId = null,
}) {
  if (!serial) return;

  const activeDeal = await tx.interStoreDeal.findFirst({
    where: {
      borrowerTenantId: tenantId,
      borrowerBranchId: branchId,
      serial,
      ...(ignoreDealId ? { id: { not: ignoreDealId } } : {}),
      status: {
        in: [
          InterStoreDealStatus.BORROWED,
          InterStoreDealStatus.RECEIVED,
          InterStoreDealStatus.SOLD,
        ],
      },
    },
    select: { id: true, status: true },
  });

  if (activeDeal) {
    throw new Error("DUPLICATE_ACTIVE_DEAL_SERIAL");
  }

  const product = await tx.product.findFirst({
    where: {
      tenantId,
      branchId,
      serial,
      ...(ignoreProductId ? { id: { not: ignoreProductId } } : {}),
      isActive: true,
    },
    select: { id: true },
  });

  if (product) {
    throw new Error("DUPLICATE_INVENTORY_SERIAL");
  }
}

function buildCollectionProjection() {
  return {
    id: true,
    borrowerBranchId: true,
    borrowerBranch: {
      select: branchSelect(),
    },
    status: true,
    productName: true,
    serial: true,
    quantity: true,
    soldQuantity: true,
    returnedQuantity: true,
    agreedPrice: true,
    soldPrice: true,
    paidAmount: true,
    paymentMethod: true,
    dueDate: true,
    borrowedAt: true,
    soldAt: true,
    resellerName: true,
    resellerPhone: true,
    resellerStore: true,
    createdAt: true,
    updatedAt: true,
  };
}

function computeDaysLeft(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24));
}

function computeDaysOverdue(dueDate) {
  if (!dueDate) return null;
  const due = new Date(dueDate).getTime();
  if (!Number.isFinite(due)) return null;
  return Math.ceil((Date.now() - due) / (1000 * 60 * 60 * 24));
}

function handleBranchError(res, err) {
  const code = String(err?.code || err?.message || "");

  if (code === "UNAUTHORIZED") {
    res.status(401).json({ message: "Unauthorized", code });
    return true;
  }

  if (code === "BRANCH_REQUIRED") {
    res.status(400).json({ message: "No active branch selected", code });
    return true;
  }

  if (code === "BRANCH_ACCESS_DENIED") {
    res.status(403).json({ message: "Branch access denied", code });
    return true;
  }

  if (code === "BRANCH_NOT_FOUND") {
    res.status(404).json({ message: "Branch not found", code });
    return true;
  }

  if (code === "BRANCH_NOT_ACTIVE") {
    res.status(409).json({ message: "Selected branch is not active", code });
    return true;
  }

  return false;
}

/**
 * INTERNAL SUPPLIERS
 */
async function listInternalSuppliers(req, res) {
  try {
    const tenantId = getTenantId(req);
    const q = cleanString(req.query.q);
    const takeRaw = toInt(req.query.take);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(1, takeRaw), 50) : 20;

    const where = {
      id: { not: tenantId },
    };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.tenant.findMany({
      where,
      orderBy: { name: "asc" },
      take,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
      },
    });

    return res.json({
      ok: true,
      suppliers: rows.map((row) => ({
        id: row.id,
        name: row.name || "Unnamed store",
        phone: row.phone || null,
        email: row.email || null,
      })),
      count: rows.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch internal suppliers" });
  }
}

/**
 * INTERNAL SUPPLIER PRODUCTS
 */
async function searchInternalSupplierProducts(req, res) {
  try {
    const borrowerTenantId = getTenantId(req);
    const supplierTenantId = cleanString(req.params.supplierTenantId);
    const q = cleanString(req.query.q);
    const supplierBranchId = cleanString(req.query.supplierBranchId);
    const takeRaw = toInt(req.query.take);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(1, takeRaw), 50) : 20;

    if (!supplierTenantId) {
      return res.status(400).json({ message: "supplierTenantId is required" });
    }

    if (supplierTenantId === borrowerTenantId) {
      return res.status(400).json({ message: "Supplier cannot be your own store" });
    }

    const where = {
      tenantId: supplierTenantId,
      isActive: true,
      stockQty: { gt: 0 },
      ...(supplierBranchId ? { branchId: supplierBranchId } : {}),
    };

    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { serial: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { brand: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      take,
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        branch: {
          select: branchSelect(),
        },
        name: true,
        serial: true,
        sku: true,
        barcode: true,
        brand: true,
        category: true,
        stockQty: true,
        sellPrice: true,
        costPrice: true,
      },
    });

    return res.json({
      ok: true,
      products: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        branchId: row.branchId || null,
        branch: serializeBranch(row.branch),
        name: row.name || "Unnamed product",
        serial: row.serial || null,
        sku: row.sku || null,
        barcode: row.barcode || null,
        brand: row.brand || null,
        category: row.category || null,
        stockQty: Number(row.stockQty || 0),
        suggestedPrice: Number(row.sellPrice || row.costPrice || 0),
      })),
      count: rows.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch supplier products" });
  }
}

/**
 * CREATE DEAL
 */
async function createDeal(req, res) {
  try {
    const borrowerTenantId = getTenantId(req);
    const actorUserId = getActorUserId(req);
    const activeBranch = await ensureWritableBranchAccessOrThrow(req);

    const payload = {
      supplierTenantId: cleanNullableString(req.body.supplierTenantId),
      externalSupplierName: cleanNullableString(req.body.externalSupplierName, 180),
      externalSupplierPhone: normalizePhone(req.body.externalSupplierPhone),
      resellerName: cleanNullableString(req.body.resellerName, 180),
      resellerPhone: normalizePhone(req.body.resellerPhone),
      resellerStore: cleanNullableString(req.body.resellerStore, 180),
      resellerWorkplace: cleanNullableString(req.body.resellerWorkplace, 180),
      resellerDistrict: cleanNullableString(req.body.resellerDistrict, 120),
      resellerSector: cleanNullableString(req.body.resellerSector, 120),
      resellerAddress: cleanNullableString(req.body.resellerAddress, 255),
      resellerNationalId: cleanNullableString(req.body.resellerNationalId, 64),
      productId: cleanNullableString(req.body.productId),
      productName: cleanNullableString(req.body.productName, 180),
      productCategory: cleanNullableString(req.body.productCategory, 120),
      productColor: cleanNullableString(req.body.productColor, 80),
      serial: normalizeSerial(req.body.serial),
      quantity: req.body.quantity,
      agreedPrice: req.body.agreedPrice,
      dueDate: req.body.dueDate,
      takenAt: req.body.takenAt,
      notes: cleanNullableString(req.body.notes, 2000),
    };

    if (!payload.resellerName || !payload.resellerPhone) {
      return res.status(400).json({ message: "resellerName and resellerPhone are required" });
    }

    if (!payload.productName) {
      return res.status(400).json({ message: "productName is required" });
    }

    if (!payload.serial) {
      return res.status(400).json({ message: "serial is required" });
    }

    if (payload.agreedPrice == null) {
      return res.status(400).json({ message: "agreedPrice is required" });
    }

    if (!payload.supplierTenantId && !payload.externalSupplierName) {
      return res.status(400).json({ message: "Supplier required (internal or external)" });
    }

    if (payload.supplierTenantId && payload.externalSupplierName) {
      return res.status(400).json({ message: "Choose one supplier type only" });
    }

    if (payload.supplierTenantId && payload.supplierTenantId === borrowerTenantId) {
      return res.status(400).json({ message: "Supplier cannot be the same tenant as borrower" });
    }

    const price = toNum(payload.agreedPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ message: "agreedPrice must be a positive number" });
    }

    const qty = payload.quantity == null ? 1 : toInt(payload.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ message: "quantity must be a positive integer" });
    }

    if (qty !== 1) {
      return res.status(400).json({
        message:
          "For serialized electronics, quantity must be 1 per deal. Next step: support quantity > 1 using serials[] list.",
      });
    }

    const parsedDueDate = payload.dueDate ? parseIsoDateOrNull(payload.dueDate) : null;
    if (payload.dueDate && !parsedDueDate) {
      return res.status(400).json({ message: "dueDate is invalid ISO date" });
    }

    if (parsedDueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (parsedDueDate < today) {
        return res.status(400).json({ message: "dueDate cannot be in the past" });
      }

      const max = new Date(today);
      max.setDate(max.getDate() + 365);

      if (parsedDueDate > max) {
        return res.status(400).json({ message: "dueDate too far in the future" });
      }
    }

    const parsedTakenAt = payload.takenAt ? parseIsoDateOrNull(payload.takenAt) : null;
    if (payload.takenAt && !parsedTakenAt) {
      return res.status(400).json({ message: "takenAt is invalid ISO date" });
    }

    const deal = await prisma.$transaction(async (tx) => {
      await assertBorrowerSerialNotDuplicated({
        tx,
        tenantId: borrowerTenantId,
        branchId: activeBranch.id,
        serial: payload.serial,
      });

      if (payload.supplierTenantId && payload.productId) {
        const stockUpdate = await tx.product.updateMany({
          where: {
            id: payload.productId,
            tenantId: payload.supplierTenantId,
            isActive: true,
            stockQty: { gte: qty },
          },
          data: {
            stockQty: { decrement: qty },
          },
        });

        if (stockUpdate.count === 0) {
          const supplierProduct = await tx.product.findFirst({
            where: {
              id: payload.productId,
              tenantId: payload.supplierTenantId,
              isActive: true,
            },
            select: { id: true, stockQty: true },
          });

          if (!supplierProduct) throw new Error("SUPPLIER_PRODUCT_NOT_FOUND");
          throw new Error("SUPPLIER_OUT_OF_STOCK");
        }
      }

      const created = await tx.interStoreDeal.create({
        data: {
          borrowerTenantId,
          borrowerBranchId: activeBranch.id,
          supplierTenantId: payload.supplierTenantId || null,
          externalSupplierName: payload.externalSupplierName || null,
          externalSupplierPhone: payload.externalSupplierPhone || null,
          resellerName: payload.resellerName,
          resellerPhone: payload.resellerPhone,
          resellerStore: payload.resellerStore,
          resellerWorkplace: payload.resellerWorkplace,
          resellerDistrict: payload.resellerDistrict,
          resellerSector: payload.resellerSector,
          resellerAddress: payload.resellerAddress,
          resellerNationalId: payload.resellerNationalId,
          productId: payload.productId || null,
          productName: payload.productName,
          productCategory: payload.productCategory,
          productColor: payload.productColor,
          serial: payload.serial,
          quantity: qty,
          soldQuantity: 0,
          returnedQuantity: 0,
          agreedPrice: price,
          dueDate: parsedDueDate,
          takenAt: parsedTakenAt,
          notes: payload.notes,
          status: InterStoreDealStatus.BORROWED,
          borrowedAt: new Date(),
        },
        select: { id: true },
      });

      return tx.interStoreDeal.findFirst({
        where: { id: created.id },
        include: dealInclude(),
      });
    });

    await logAudit({
      tenantId: borrowerTenantId,
      branchId: activeBranch.id,
      userId: actorUserId,
      action: AuditAction.CREATE_DEAL,
      entity: "INTERSTORE_DEAL",
      entityId: deal.id,
      metadata: {
        borrowerBranchId: deal.borrowerBranchId || activeBranch.id,
        branchName: activeBranch.name,
        supplierTenantId: payload.supplierTenantId || null,
        externalSupplierName: payload.externalSupplierName || null,
        productId: payload.productId || null,
        productName: deal.productName,
        serial: deal.serial,
        quantity: deal.quantity,
        agreedPrice: deal.agreedPrice,
        resellerPhone: deal.resellerPhone,
        dueDate: deal.dueDate || null,
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Deal created",
      deal: serializeDeal(deal),
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    if (err.message === "SUPPLIER_PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Supplier product not found" });
    }

    if (err.message === "SUPPLIER_OUT_OF_STOCK") {
      return res.status(400).json({ message: "Supplier product out of stock" });
    }

    if (err.message === "DUPLICATE_ACTIVE_DEAL_SERIAL") {
      return res.status(409).json({
        message: "This serial already exists in another active inter-store deal for this branch",
      });
    }

    if (err.message === "DUPLICATE_INVENTORY_SERIAL") {
      return res.status(409).json({
        message: "This serial already exists in this branch inventory",
      });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to create deal" });
  }
}

/**
 * MARK RECEIVED
 */
async function markReceived(req, res) {
  try {
    const id = cleanString(req.params.id);
    const tenantId = getTenantId(req);
    const actorUserId = getActorUserId(req);
    const scope = resolveBorrowerBranchScope(req);

    const deal = await getBorrowerDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (deal.status === InterStoreDealStatus.RECEIVED && deal.receivedProductId) {
      return dealSuccess(res, deal, { message: "Deal already marked as received" });
    }

    if (deal.status !== InterStoreDealStatus.BORROWED) {
      return res.status(400).json({ message: `Cannot mark received in status ${deal.status}` });
    }

    const result = await prisma.$transaction(async (tx) => {
      await assertBorrowerSerialNotDuplicated({
        tx,
        tenantId,
        branchId: deal.borrowerBranchId,
        serial: deal.serial,
        ignoreDealId: deal.id,
      });

      let receivedProductId = deal.receivedProductId || null;

      if (!receivedProductId) {
        const createdProduct = await tx.product.create({
          data: {
            tenantId: deal.borrowerTenantId,
            branchId: deal.borrowerBranchId,
            name: deal.productName,
            serial: deal.serial,
            costPrice: deal.agreedPrice,
            sellPrice: deal.agreedPrice,
            stockQty: deal.quantity,
            isActive: true,
          },
          select: { id: true },
        });

        receivedProductId = createdProduct.id;
      }

      const upd = await tx.interStoreDeal.updateMany({
        where: {
          ...buildBorrowerDealWhere(deal.id, tenantId, scope),
          status: InterStoreDealStatus.BORROWED,
        },
        data: {
          status: InterStoreDealStatus.RECEIVED,
          receivedAt: new Date(),
          receivedProductId,
        },
      });

      if (upd.count === 0) return null;

      return tx.interStoreDeal.findFirst({
        where: buildBorrowerDealWhere(deal.id, tenantId, scope),
        include: dealInclude(),
      });
    });

    if (!result) {
      return res.status(409).json({ message: "Deal changed; refresh and try again" });
    }

    await logAudit({
      tenantId,
      branchId: result.borrowerBranchId || null,
      userId: actorUserId,
      action: AuditAction.MARK_RECEIVED,
      entity: "INTERSTORE_DEAL",
      entityId: result.id,
      metadata: {
        borrowerBranchId: result.borrowerBranchId || null,
        receivedProductId: result.receivedProductId,
        quantity: result.quantity,
      },
    });

    return dealSuccess(res, result, { message: "Deal marked as received" });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    if (err.message === "DUPLICATE_ACTIVE_DEAL_SERIAL") {
      return res.status(409).json({
        message: "This serial already exists in another active inter-store deal for this branch",
      });
    }

    if (err.message === "DUPLICATE_INVENTORY_SERIAL") {
      return res.status(409).json({
        message: "This serial already exists in this branch inventory",
      });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to mark received" });
  }
}

/**
 * MARK SOLD
 */
async function markSold(req, res) {
  try {
    const id = cleanString(req.params.id);
    const tenantId = getTenantId(req);
    const actorUserId = getActorUserId(req);
    const scope = resolveBorrowerBranchScope(req);
    const { soldPrice, soldQuantity } = req.body;

    const sp = soldPrice == null ? null : toNum(soldPrice);
    if (soldPrice != null && (!Number.isFinite(sp) || sp <= 0)) {
      return res.status(400).json({ message: "soldPrice must be a positive number" });
    }

    const sq = soldQuantity == null ? 1 : toInt(soldQuantity);
    if (!Number.isFinite(sq) || sq <= 0) {
      return res.status(400).json({ message: "soldQuantity must be a positive integer" });
    }

    const deal = await getBorrowerDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (deal.status !== InterStoreDealStatus.RECEIVED) {
      return res.status(400).json({ message: `Cannot mark sold in status ${deal.status}` });
    }

    if (!deal.receivedProductId) {
      return res.status(400).json({ message: "Deal has no receivedProductId. Receive first." });
    }

    const remaining = deal.quantity - deal.soldQuantity - deal.returnedQuantity;
    if (sq > remaining) {
      return res.status(400).json({ message: `Cannot sell ${sq}. Remaining is ${remaining}.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const prodUpd = await tx.product.updateMany({
        where: {
          id: deal.receivedProductId,
          tenantId,
          branchId: deal.borrowerBranchId,
          stockQty: { gte: sq },
        },
        data: { stockQty: { decrement: sq } },
      });

      if (prodUpd.count === 0) {
        throw new Error("BORROWER_PRODUCT_OUT_OF_STOCK_OR_NOT_FOUND");
      }

      const newSoldQty = deal.soldQuantity + sq;
      const fullyResolved = newSoldQty + deal.returnedQuantity === deal.quantity;

      const upd = await tx.interStoreDeal.updateMany({
        where: {
          ...buildBorrowerDealWhere(deal.id, tenantId, scope),
          status: InterStoreDealStatus.RECEIVED,
        },
        data: {
          soldQuantity: newSoldQty,
          soldAt: fullyResolved ? new Date() : deal.soldAt,
          soldPrice: sp ?? deal.soldPrice,
          status: fullyResolved ? InterStoreDealStatus.SOLD : InterStoreDealStatus.RECEIVED,
        },
      });

      if (upd.count === 0) return null;

      const p = await tx.product.findFirst({
        where: {
          id: deal.receivedProductId,
          tenantId,
          branchId: deal.borrowerBranchId,
        },
        select: { stockQty: true },
      });

      if (p && p.stockQty <= 0) {
        await tx.product.updateMany({
          where: {
            id: deal.receivedProductId,
            tenantId,
            branchId: deal.borrowerBranchId,
          },
          data: { isActive: false },
        });
      }

      return tx.interStoreDeal.findFirst({
        where: buildBorrowerDealWhere(deal.id, tenantId, scope),
        include: dealInclude(),
      });
    });

    if (!updated) {
      return res.status(409).json({ message: "Deal changed; refresh and try again" });
    }

    await logAudit({
      tenantId,
      branchId: updated.borrowerBranchId || null,
      userId: actorUserId,
      action: AuditAction.MARK_SOLD,
      entity: "INTERSTORE_DEAL",
      entityId: updated.id,
      metadata: {
        borrowerBranchId: updated.borrowerBranchId || null,
        soldQuantity: sq,
        totalSoldQuantity: updated.soldQuantity,
        soldPrice: sp,
      },
    });

    return dealSuccess(res, updated, { message: "Deal sale recorded" });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    if (err.message === "BORROWER_PRODUCT_OUT_OF_STOCK_OR_NOT_FOUND") {
      return res.status(400).json({
        message: "Borrower branch inventory product not found or insufficient stock",
      });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to mark sold" });
  }
}

/**
 * MARK RETURNED
 */
async function markReturned(req, res) {
  try {
    const id = cleanString(req.params.id);
    const tenantId = getTenantId(req);
    const actorUserId = getActorUserId(req);
    const scope = resolveBorrowerBranchScope(req);
    const { returnedQuantity } = req.body;

    const rq = returnedQuantity == null ? 1 : toInt(returnedQuantity);
    if (!Number.isFinite(rq) || rq <= 0) {
      return res.status(400).json({ message: "returnedQuantity must be a positive integer" });
    }

    const deal = await getBorrowerDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (![InterStoreDealStatus.BORROWED, InterStoreDealStatus.RECEIVED].includes(deal.status)) {
      return res.status(400).json({ message: `Cannot return in status ${deal.status}` });
    }

    const remaining = deal.quantity - deal.soldQuantity - deal.returnedQuantity;
    if (rq > remaining) {
      return res.status(400).json({ message: `Cannot return ${rq}. Remaining is ${remaining}.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (deal.receivedProductId) {
        const prodUpd = await tx.product.updateMany({
          where: {
            id: deal.receivedProductId,
            tenantId,
            branchId: deal.borrowerBranchId,
            stockQty: { gte: rq },
          },
          data: { stockQty: { decrement: rq } },
        });

        if (prodUpd.count === 0) {
          throw new Error("BORROWER_PRODUCT_OUT_OF_STOCK_OR_NOT_FOUND");
        }

        const p = await tx.product.findFirst({
          where: {
            id: deal.receivedProductId,
            tenantId,
            branchId: deal.borrowerBranchId,
          },
          select: { stockQty: true },
        });

        if (p && p.stockQty <= 0) {
          await tx.product.updateMany({
            where: {
              id: deal.receivedProductId,
              tenantId,
              branchId: deal.borrowerBranchId,
            },
            data: { isActive: false },
          });
        }
      }

      if (deal.supplierTenantId && deal.productId) {
        const supplierRestore = await tx.product.updateMany({
          where: {
            id: deal.productId,
            tenantId: deal.supplierTenantId,
          },
          data: { stockQty: { increment: rq } },
        });

        if (supplierRestore.count === 0) {
          throw new Error("SUPPLIER_PRODUCT_NOT_FOUND");
        }
      }

      const newReturnedQty = deal.returnedQuantity + rq;
      const fullyResolved = deal.soldQuantity + newReturnedQty === deal.quantity;
      const nextStatus = fullyResolved ? InterStoreDealStatus.RETURNED : deal.status;

      const upd = await tx.interStoreDeal.updateMany({
        where: {
          ...buildBorrowerDealWhere(deal.id, tenantId, scope),
          status: {
            in: [InterStoreDealStatus.BORROWED, InterStoreDealStatus.RECEIVED],
          },
        },
        data: {
          returnedQuantity: newReturnedQty,
          returnedAt: fullyResolved ? new Date() : deal.returnedAt,
          status: nextStatus,
        },
      });

      if (upd.count === 0) return null;

      return tx.interStoreDeal.findFirst({
        where: buildBorrowerDealWhere(deal.id, tenantId, scope),
        include: dealInclude(),
      });
    });

    if (!updated) {
      return res.status(409).json({ message: "Deal changed; refresh and try again" });
    }

    await logAudit({
      tenantId,
      branchId: updated.borrowerBranchId || null,
      userId: actorUserId,
      action: AuditAction.MARK_RETURNED,
      entity: "INTERSTORE_DEAL",
      entityId: updated.id,
      metadata: {
        borrowerBranchId: updated.borrowerBranchId || null,
        returnedQuantity: rq,
        totalReturnedQuantity: updated.returnedQuantity,
      },
    });

    return dealSuccess(res, updated, { message: "Deal return recorded" });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    if (err.message === "BORROWER_PRODUCT_OUT_OF_STOCK_OR_NOT_FOUND") {
      return res.status(400).json({
        message: "Borrower branch inventory product not found or insufficient stock",
      });
    }

    if (err.message === "SUPPLIER_PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Supplier product not found" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to mark returned" });
  }
}

/**
 * MARK PAID
 */
async function markPaid(req, res) {
  try {
    const id = cleanString(req.params.id);
    const tenantId = getTenantId(req);
    const actorUserId = getActorUserId(req);
    const scope = resolveBorrowerBranchScope(req);
    const { paidAmount, paymentMethod } = req.body;

    const amt = paidAmount == null ? null : toNum(paidAmount);
    if (amt == null || !Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "paidAmount must be a positive number" });
    }

    const normalizedMethod = paymentMethod ? normalizeInterStoreMethod(paymentMethod) : null;

    if (paymentMethod && !normalizedMethod) {
      return res.status(400).json({
        message: "paymentMethod must be one of CASH, MOMO, BANK, OTHER",
      });
    }

    const deal = await getBorrowerDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (deal.status !== InterStoreDealStatus.SOLD) {
      return res.status(400).json({ message: `Cannot mark paid in status ${deal.status}` });
    }

    const owed = Number(deal.agreedPrice) * Number(deal.soldQuantity || 0);
    if (!Number.isFinite(owed) || owed <= 0) {
      return res.status(400).json({ message: "Invalid owed amount" });
    }

    if (amt < owed) {
      return res.status(400).json({
        message: "Cannot mark PAID. paidAmount is less than amount owed to supplier.",
        owed,
        paidAmount: amt,
      });
    }

    const upd = await prisma.interStoreDeal.updateMany({
      where: {
        ...buildBorrowerDealWhere(deal.id, tenantId, scope),
        status: InterStoreDealStatus.SOLD,
      },
      data: {
        status: InterStoreDealStatus.PAID,
        paidAt: new Date(),
        paidAmount: amt,
        paymentMethod: normalizedMethod || null,
      },
    });

    if (upd.count === 0) {
      return res.status(409).json({ message: "Deal changed; refresh and try again" });
    }

    const updated = await getBorrowerDealOrNull({ id: deal.id, tenantId, scope });

    await logAudit({
      tenantId,
      branchId: updated?.borrowerBranchId || null,
      userId: actorUserId,
      action: AuditAction.MARK_PAID,
      entity: "INTERSTORE_DEAL",
      entityId: deal.id,
      metadata: {
        borrowerBranchId: updated?.borrowerBranchId || null,
        paidAmount: amt,
        paymentMethod: updated?.paymentMethod || null,
        owed,
      },
    });

    return dealSuccess(res, updated, { message: "Deal marked as paid" });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to mark paid" });
  }
}

/**
 * LIST DEALS
 */
async function listDeals(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);

    const borrowerWhere = withBorrowerBranchScope({ borrowerTenantId: tenantId }, scope);

    const deals = await prisma.interStoreDeal.findMany({
      where: {
        OR: [
          borrowerWhere,
          {
            supplierTenantId: tenantId,
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: dealInclude(),
    });

    return dealsListSuccess(res, deals, { branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch deals" });
  }
}

async function listOutstanding(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);

    const deals = await prisma.interStoreDeal.findMany({
      where: withBorrowerBranchScope(
        {
          borrowerTenantId: tenantId,
          status: InterStoreDealStatus.SOLD,
        },
        scope
      ),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: buildCollectionProjection(),
    });

    const items = deals.map((d) => ({
      ...serializeDeal(d),
      daysLeft: computeDaysLeft(d.dueDate),
    }));

    return res.json({ ok: true, deals: items, count: items.length, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch outstanding deals" });
  }
}

async function listOverdue(req, res) {
  try {
    const tenantId = getTenantId(req);
    const now = new Date();
    const scope = resolveBorrowerBranchScope(req);

    const deals = await prisma.interStoreDeal.findMany({
      where: withBorrowerBranchScope(
        {
          borrowerTenantId: tenantId,
          status: InterStoreDealStatus.SOLD,
          dueDate: { not: null, lt: now },
        },
        scope
      ),
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: buildCollectionProjection(),
    });

    const items = deals.map((d) => ({
      ...serializeDeal(d),
      daysOverdue: computeDaysOverdue(d.dueDate),
    }));

    return res.json({ ok: true, deals: items, count: items.length, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch overdue deals" });
  }
}

async function searchDeals(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);
    const qRaw = req.query.q;

    if (!qRaw || String(qRaw).trim().length < 2) {
      return res.status(400).json({ message: "Query 'q' is required (min 2 chars)" });
    }

    const q = String(qRaw).trim();

    const deals = await prisma.interStoreDeal.findMany({
      where: withBorrowerBranchScope(
        {
          borrowerTenantId: tenantId,
          OR: [
            { serial: { contains: q, mode: "insensitive" } },
            { resellerPhone: { contains: q, mode: "insensitive" } },
            { resellerName: { contains: q, mode: "insensitive" } },
            { productName: { contains: q, mode: "insensitive" } },
            { borrowerBranch: { name: { contains: q, mode: "insensitive" } } },
            { borrowerBranch: { code: { contains: q, mode: "insensitive" } } },
          ],
        },
        scope
      ),
      orderBy: { createdAt: "desc" },
      take: 50,
      include: dealInclude(),
    });

    return dealsListSuccess(res, deals, { branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to search deals" });
  }
}

async function searchCollections(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);
    const qRaw = req.query.q;
    const scopeFilter = String(req.query.scope || "all").toLowerCase();
    const q = qRaw ? String(qRaw).trim() : "";

    const andWhere = [withBorrowerBranchScope({ borrowerTenantId: tenantId }, scope)];

    if (scopeFilter === "outstanding") {
      andWhere.push({ status: InterStoreDealStatus.SOLD });
    } else if (scopeFilter === "overdue") {
      andWhere.push({
        status: InterStoreDealStatus.SOLD,
        dueDate: { not: null, lt: new Date() },
      });
    }

    if (q.length >= 2) {
      andWhere.push({
        OR: [
          { serial: { contains: q, mode: "insensitive" } },
          { resellerPhone: { contains: q, mode: "insensitive" } },
          { resellerName: { contains: q, mode: "insensitive" } },
          { productName: { contains: q, mode: "insensitive" } },
          { borrowerBranch: { name: { contains: q, mode: "insensitive" } } },
          { borrowerBranch: { code: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const deals = await prisma.interStoreDeal.findMany({
      where: { AND: andWhere },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: dealInclude(),
    });

    return dealsListSuccess(res, deals, { branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to search collections" });
  }
}

/**
 * ADD PAYMENT
 */
async function addPayment(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getActorUserId(req);
    const id = cleanString(req.params.id);
    const scope = resolveBorrowerBranchScope(req);
    const { amount, method, note } = req.body;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const normalizedMethod = normalizeInterStoreMethod(method);
    if (!normalizedMethod) {
      return res.status(400).json({
        message: "method must be one of CASH, MOMO, BANK, OTHER",
      });
    }

    const deal = await getBorrowerDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (deal.status === InterStoreDealStatus.PAID) {
      return res.status(400).json({ message: "Deal already fully paid" });
    }

    if (deal.status !== InterStoreDealStatus.SOLD) {
      return res.status(400).json({
        message: `Cannot add payment in status ${deal.status}. Sell first (status must be SOLD).`,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const aggBefore = await tx.interStorePayment.aggregate({
        where: { dealId: deal.id },
        _sum: { amount: true },
      });

      const totalPaidBefore = Number(aggBefore._sum.amount || 0);
      const owedRaw = Number(deal.agreedPrice) * Number(deal.soldQuantity || 0);
      const owed = Number.isFinite(owedRaw) ? owedRaw : 0;

      if (owed <= 0) throw new Error("INVALID_OWED_AMOUNT");

      if (totalPaidBefore + amt > owed) {
        return { overpay: true, owed, totalPaidBefore };
      }

      const payment = await tx.interStorePayment.create({
        data: {
          dealId: deal.id,
          tenantId,
          branchId: deal.borrowerBranchId || null,
          receivedById: userId,
          amount: amt,
          method: normalizedMethod,
          note: note ? String(note).slice(0, 2000) : null,
        },
        include: paymentInclude(),
      });

      const aggAfter = await tx.interStorePayment.aggregate({
        where: { dealId: deal.id },
        _sum: { amount: true },
      });

      const totalPaidAfter = Number(aggAfter._sum.amount || 0);
      const nextStatus =
        totalPaidAfter >= owed ? InterStoreDealStatus.PAID : InterStoreDealStatus.SOLD;

      const updatedDeal = await tx.interStoreDeal.updateMany({
        where: {
          ...buildBorrowerDealWhere(deal.id, tenantId, scope),
          status: InterStoreDealStatus.SOLD,
        },
        data: {
          paidAmount: totalPaidAfter,
          paymentMethod: normalizedMethod,
          paidAt: nextStatus === InterStoreDealStatus.PAID ? new Date() : deal.paidAt,
          status: nextStatus,
        },
      });

      if (updatedDeal.count === 0) return null;

      const reRead = await tx.interStoreDeal.findFirst({
        where: buildBorrowerDealWhere(deal.id, tenantId, scope),
        include: dealInclude(),
      });

      return {
        overpay: false,
        payment,
        updatedDeal: reRead,
        totalPaid: totalPaidAfter,
        owed,
      };
    });

    if (result == null) {
      return res.status(409).json({ message: "Deal changed; refresh and try again" });
    }

    if (result.overpay) {
      return res.status(400).json({
        message: "Payment exceeds amount owed",
        owed: result.owed,
        totalPaid: result.totalPaidBefore,
        attemptedPayment: amt,
        balanceDue: Math.max(0, result.owed - result.totalPaidBefore),
      });
    }

    await logAudit({
      tenantId,
      branchId: result.updatedDeal?.borrowerBranchId || null,
      userId,
      action: AuditAction.ADD_PAYMENT,
      entity: "INTERSTORE_DEAL",
      entityId: deal.id,
      metadata: {
        borrowerBranchId: result.updatedDeal?.borrowerBranchId || null,
        dealId: deal.id,
        paymentId: result.payment.id,
        amount: amt,
        method: normalizedMethod,
        note: note ? String(note).slice(0, 2000) : null,
        totalPaid: result.totalPaid,
        owed: result.owed,
        statusAfter: result.updatedDeal?.status || null,
      },
    });

    return res.json({
      ok: true,
      message: "Installment recorded",
      payment: serializePayment(result.payment),
      deal: {
        id: result.updatedDeal.id,
        status: result.updatedDeal.status,
        borrowerBranchId: result.updatedDeal.borrowerBranchId || null,
        borrowerBranch: result.updatedDeal.borrowerBranch
          ? serializeBranch(result.updatedDeal.borrowerBranch)
          : null,
        agreedPrice: Number(result.updatedDeal.agreedPrice),
        soldQuantity: Number(result.updatedDeal.soldQuantity || 0),
        owed: result.owed,
        paidAmount: result.totalPaid,
        balanceDue: Math.max(0, result.owed - result.totalPaid),
      },
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    if (err.message === "INVALID_OWED_AMOUNT") {
      return res.status(400).json({
        message: "Invalid owed amount. Check agreed price and sold quantity.",
      });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to add payment" });
  }
}

async function listDealAudit(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);

    const logs = await prisma.auditLog.findMany({
      where: {
        tenantId,
        entity: "INTERSTORE_DEAL",
        ...(scope.mode === "SINGLE_BRANCH" && scope.branchId ? { branchId: scope.branchId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        branch: {
          select: branchSelect(),
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return res.json({ ok: true, logs, count: logs.length, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch audit logs" });
  }
}

async function getDeal(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);
    const id = cleanString(req.params.id);

    const deal = await getVisibleDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    return dealSuccess(res, deal, { branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch deal" });
  }
}

async function listPayments(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);
    const takeRaw = Number(req.query.take);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(1, takeRaw), 200) : 50;
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const q = req.query.q ? String(req.query.q).trim() : "";
    const dealId = req.query.dealId ? String(req.query.dealId).trim() : null;
    const method = req.query.method ? String(req.query.method).trim().toUpperCase() : null;
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    if (from && Number.isNaN(from.getTime())) {
      return res.status(400).json({ message: "from is invalid date" });
    }

    if (to && Number.isNaN(to.getTime())) {
      return res.status(400).json({ message: "to is invalid date" });
    }

    let toInclusive = null;
    if (to) {
      toInclusive = new Date(to);
      toInclusive.setHours(23, 59, 59, 999);
    }

    let methodFilter = null;
    if (method) {
      const m = normalizeInterStoreMethod(method);
      if (!m) {
        return res.status(400).json({
          message: "method must be one of CASH, MOMO, BANK, OTHER",
        });
      }
      methodFilter = m;
    }

    let statusFilter = null;
    if (status) {
      if (!ALLOWED_COLLECTION_STATUSES.has(status)) {
        return res.status(400).json({
          message: `status must be one of ${Array.from(ALLOWED_COLLECTION_STATUSES).join(", ")}`,
        });
      }
      statusFilter = status;
    }

    const borrowerDealFilter = withBorrowerBranchScope({ borrowerTenantId: tenantId }, scope);

    const andWhere = [
      {
        OR: [
          { tenantId },
          { deal: borrowerDealFilter },
          { deal: { supplierTenantId: tenantId } },
        ],
      },
    ];

    if (dealId) {
      andWhere.push({ dealId });
    }

    if (methodFilter) {
      andWhere.push({ method: methodFilter });
    }

    if (from || toInclusive) {
      andWhere.push({
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(toInclusive ? { lte: toInclusive } : {}),
        },
      });
    }

    if (statusFilter) {
      andWhere.push({ deal: { status: statusFilter } });
    }

    if (scope.mode === "SINGLE_BRANCH" && scope.branchId) {
      andWhere.push({
        OR: [
          { branchId: scope.branchId },
          { deal: { supplierTenantId: tenantId } },
        ],
      });
    }

    if (q.length >= 2) {
      andWhere.push({
        OR: [
          { deal: { serial: { contains: q, mode: "insensitive" } } },
          { deal: { productName: { contains: q, mode: "insensitive" } } },
          { deal: { resellerPhone: { contains: q, mode: "insensitive" } } },
          { deal: { resellerName: { contains: q, mode: "insensitive" } } },
          { branch: { name: { contains: q, mode: "insensitive" } } },
          { branch: { code: { contains: q, mode: "insensitive" } } },
        ],
      });
    }

    const payments = await prisma.interStorePayment.findMany({
      where: { AND: andWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: paymentInclude(),
    });

    const hasNextPage = payments.length > take;
    const items = hasNextPage ? payments.slice(0, take) : payments;
    const nextCursor = hasNextPage ? items[items.length - 1]?.id : null;

    return paymentsListSuccess(res, items, {
      page: { take, cursor, nextCursor, hasNextPage },
      filters: {
        q: q || null,
        dealId,
        method: methodFilter,
        status: statusFilter,
        from: from ? from.toISOString() : null,
        to: toInclusive ? toInclusive.toISOString() : null,
      },
      branchScope: scope,
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch payments" });
  }
}

async function getDealPayments(req, res) {
  try {
    const tenantId = getTenantId(req);
    const scope = resolveBorrowerBranchScope(req);
    const id = cleanString(req.params.id);

    const deal = await getVisibleDealOrNull({ id, tenantId, scope });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    const payments = await prisma.interStorePayment.findMany({
      where: { dealId: id },
      orderBy: { createdAt: "asc" },
      include: {
        branch: {
          select: branchSelect(),
        },
      },
    });

    const totalPaid = payments.reduce((sum, p) => {
      const n = Number(p.amount);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    const soldQty = Number(deal.soldQuantity || 0);
    const price = Number(deal.agreedPrice);
    const owed =
      deal.status === InterStoreDealStatus.SOLD || deal.status === InterStoreDealStatus.PAID
        ? (Number.isFinite(price) ? price : 0) * (Number.isFinite(soldQty) ? soldQty : 0)
        : 0;

    return res.json({
      ok: true,
      dealId: id,
      status: deal.status,
      borrowerBranchId: deal.borrowerBranchId || null,
      borrowerBranch: deal.borrowerBranch ? serializeBranch(deal.borrowerBranch) : null,
      agreedPrice: Number.isFinite(price) ? price : 0,
      soldQuantity: Number.isFinite(soldQty) ? soldQty : 0,
      owed,
      totalPaid,
      balanceDue: Math.max(0, owed - totalPaid),
      payments: payments.map(serializePayment),
      count: payments.length,
      summary: {
        owed,
        totalPaid,
        balanceDue: Math.max(0, owed - totalPaid),
        count: payments.length,
      },
      branchScope: scope,
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch deal payments" });
  }
}

module.exports = {
  listInternalSuppliers,
  searchInternalSupplierProducts,
  createDeal,
  markReceived,
  markSold,
  markReturned,
  markPaid,
  listDeals,
  getDeal,
  listPayments,
  listDealAudit,
  listOutstanding,
  listOverdue,
  searchDeals,
  searchCollections,
  addPayment,
  getDealPayments,
};