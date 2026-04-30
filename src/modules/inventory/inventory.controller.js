const prisma = require("../../config/database");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

const INVENTORY_AUDIT_ACTIONS = {
  PRODUCT_CREATED: "PRODUCT_CREATED",
  PRODUCT_UPDATED: "PRODUCT_UPDATED",
  PRODUCT_DEACTIVATED: "PRODUCT_DEACTIVATED",
  PRODUCT_ACTIVATED: "PRODUCT_ACTIVATED",
};

const LOSS_REASON_OPTIONS = [
  "STOLEN",
  "DAMAGED",
  "LOST",
  "EXPIRED",
  "INTERNAL_USE",
  "COUNTING_ERROR",
  "OTHER",
];

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function getActiveBranchId(req) {
  return (
    cleanString(req.user?.activeBranchId) ||
    cleanString(req.user?.branchId) ||
    cleanString(req.branchAccess?.activeBranchId) ||
    cleanString(req.branch?.id) ||
    null
  );
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function getDbPermissions(req) {
  return Array.isArray(req.dbPermissions) ? req.dbPermissions : [];
}

function hasDbPermission(req, permissionKey) {
  return getDbPermissions(req).includes(permissionKey);
}

function toInt(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return NaN;
  return Math.floor(n);
}

function toMoney(x) {
  const n = typeof x === "string" ? Number(x.trim()) : Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function cleanBool(x) {
  if (x == null) return null;
  const v = String(x).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function normalizeSort(x) {
  const v = String(x || "").trim().toLowerCase();
  return ["newest", "name", "stock_low", "stock_high"].includes(v) ? v : "newest";
}

function normalizeAdjustmentType(x) {
  const v = String(x || "").trim().toUpperCase();
  if (v === "RESTOCK" || v === "LOSS" || v === "CORRECTION") return v;
  return null;
}

function normalizeLossReason(x) {
  const v = String(x || "").trim().toUpperCase();
  return LOSS_REASON_OPTIONS.includes(v) ? v : null;
}

function parseDateOnly(s) {
  if (!s) return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function formatRwf(n) {
  const x = Number(n || 0);
  return `RWF ${x.toLocaleString()}`;
}

function normalizeCategoryValue(x) {
  return cleanString(x);
}

function normalizeSubcategoryValue(x) {
  return cleanString(x);
}

function normalizeBarcode(x) {
  const raw = cleanString(x);
  if (!raw) return null;
  return raw.replace(/\s+/g, "");
}

function parseMinStockLevel(x) {
  if (x == null || x === "") return null;
  const n = toInt(x);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function productSelect() {
  return {
    id: true,
    name: true,
    sku: true,
    serial: true,
    barcode: true,
    category: true,
    subcategory: true,
    subcategoryOther: true,
    brand: true,
    minStockLevel: true,
    costPrice: true,
    sellPrice: true,
    stockQty: true,
    isActive: true,
    createdAt: true,
  };
}

async function writeAuditLog(tx, { tenantId, userId, branchId, entity, entityId, action, metadata }) {
  try {
    if (!Object.values(INVENTORY_AUDIT_ACTIONS).includes(action)) {
      return;
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
        branchId: branchId || null,
        entity,
        entityId: entityId || null,
        action,
        metadata: metadata || null,
      },
    });
  } catch (err) {
    console.error("writeAuditLog error:", err);
  }
}

async function ensureUniqueProductFields({
  tx,
  tenantId,
  id = null,
  serial = null,
  barcode = null,
  sku = null,
}) {
  if (serial) {
    const existingSerial = await tx.product.findFirst({
      where: {
        tenantId,
        serial,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });

    if (existingSerial) {
      const e = new Error("SERIAL_EXISTS");
      e.code = "SERIAL_EXISTS";
      throw e;
    }
  }

  if (barcode) {
    const existingBarcode = await tx.product.findFirst({
      where: {
        tenantId,
        barcode,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });

    if (existingBarcode) {
      const e = new Error("BARCODE_EXISTS");
      e.code = "BARCODE_EXISTS";
      throw e;
    }
  }

  if (sku) {
    const existingSku = await tx.product.findFirst({
      where: {
        tenantId,
        sku,
        ...(id ? { NOT: { id } } : {}),
      },
      select: { id: true },
    });

    if (existingSku) {
      const e = new Error("SKU_EXISTS");
      e.code = "SKU_EXISTS";
      throw e;
    }
  }
}

function normalizeProductInput(body, { isCreate = false } = {}) {
  const data = {};

  if (isCreate || body.name != null) {
    const name = cleanString(body.name);
    if (!name) {
      const e = new Error("NAME_REQUIRED");
      e.code = "NAME_REQUIRED";
      throw e;
    }
    data.name = name;
  }

  if (isCreate || body.sku != null) data.sku = cleanString(body.sku);
  if (isCreate || body.serial != null) data.serial = cleanString(body.serial);
  if (isCreate || body.barcode != null) data.barcode = normalizeBarcode(body.barcode);

  if (isCreate || body.category != null) data.category = normalizeCategoryValue(body.category);
  if (isCreate || body.subcategory != null) data.subcategory = normalizeSubcategoryValue(body.subcategory);
  if (isCreate || body.subcategoryOther != null) data.subcategoryOther = cleanString(body.subcategoryOther);
  if (isCreate || body.brand != null) data.brand = cleanString(body.brand);

  if (isCreate || body.minStockLevel != null) {
    const minStockLevel = parseMinStockLevel(body.minStockLevel);
    if (!Number.isFinite(minStockLevel) && minStockLevel !== null) {
      const e = new Error("INVALID_MIN_STOCK");
      e.code = "INVALID_MIN_STOCK";
      throw e;
    }
    data.minStockLevel = minStockLevel;
  }

  if (isCreate || body.costPrice != null) {
    const costPrice = toMoney(body.costPrice);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      const e = new Error("INVALID_COST_PRICE");
      e.code = "INVALID_COST_PRICE";
      throw e;
    }
    data.costPrice = costPrice;
  }

  if (isCreate || body.sellPrice != null) {
    const sellPrice = toMoney(body.sellPrice);
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      const e = new Error("INVALID_SELL_PRICE");
      e.code = "INVALID_SELL_PRICE";
      throw e;
    }
    data.sellPrice = sellPrice;
  }

  if (isCreate) {
    const stockQty = toInt(body.stockQty);
    if (!Number.isFinite(stockQty) || stockQty < 0) {
      const e = new Error("INVALID_STOCK_QTY");
      e.code = "INVALID_STOCK_QTY";
      throw e;
    }
    data.stockQty = stockQty;
  } else if (body.stockQty != null) {
    const e = new Error("STOCK_QTY_FORBIDDEN");
    e.code = "STOCK_QTY_FORBIDDEN";
    throw e;
  }

  if (data.category && String(data.category) !== "Accessories") {
    data.subcategory = null;
    data.subcategoryOther = null;
  }

  if (data.subcategory && data.subcategory !== "Other") {
    data.subcategoryOther = null;
  }

  return data;
}

function buildProductWhere(req) {
  const tenantId = getTenantId(req);
  const q = cleanString(req.query.q);
  const activeParam = cleanBool(req.query.active);
  const isActive = activeParam == null ? true : activeParam;
  const category = cleanString(req.query.category);
  const subcategory = cleanString(req.query.subcategory);
  const brand = cleanString(req.query.brand);

  const where = { tenantId, isActive };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { serial: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { subcategory: { contains: q, mode: "insensitive" } },
      { subcategoryOther: { contains: q, mode: "insensitive" } },
    ];
  }

  if (category) where.category = { equals: category, mode: "insensitive" };
  if (subcategory) where.subcategory = { equals: subcategory, mode: "insensitive" };
  if (brand) where.brand = { equals: brand, mode: "insensitive" };

  return where;
}

function buildProductOrderBy(sort) {
  let orderBy = [{ createdAt: "desc" }];
  if (sort === "name") orderBy = [{ name: "asc" }, { createdAt: "desc" }];
  if (sort === "stock_low") orderBy = [{ stockQty: "asc" }, { createdAt: "desc" }];
  if (sort === "stock_high") orderBy = [{ stockQty: "desc" }, { createdAt: "desc" }];
  return orderBy;
}

function sortByEffectiveStock(products, sort) {
  if (sort !== "stock_low" && sort !== "stock_high") return products;

  return [...products].sort((a, b) => {
    const aq = Number(a.effectiveStockQty || 0);
    const bq = Number(b.effectiveStockQty || 0);

    if (sort === "stock_low") return aq - bq || String(a.name || "").localeCompare(String(b.name || ""));
    return bq - aq || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function categoryText(p) {
  const parts = [];
  if (p.category) parts.push(p.category);

  if (p.category === "Accessories") {
    if (p.subcategory === "Other") parts.push(p.subcategoryOther || "Other");
    else if (p.subcategory) parts.push(p.subcategory);
  }

  return parts.length ? parts.join(" • ") : "—";
}

function stockThresholdForProduct(product, fallbackThreshold) {
  const min =
    Number.isFinite(Number(product?.minStockLevel)) && Number(product?.minStockLevel) >= 0
      ? Number(product.minStockLevel)
      : null;

  return min != null ? min : fallbackThreshold;
}

function makeWorkbookHeaderRow(ws, headers) {
  ws.addRow(headers);
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0F172A" },
  };
  row.height = 22;
}

function autosizeWorksheet(ws, min = 12, max = 36) {
  ws.columns.forEach((column) => {
    let longest = min;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const value = cell.value == null ? "" : String(cell.value);
      longest = Math.max(longest, value.length + 2);
    });

    column.width = Math.min(Math.max(longest, min), max);
  });
}

function styleDataRows(ws) {
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.alignment = { vertical: "middle" };

    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });
}

function buildStockAdjustmentNote({ type, lossReason, note }) {
  const cleanNote = cleanString(note);

  if (type !== "LOSS") return cleanNote;
  if (!lossReason) return cleanNote;
  if (cleanNote) return `Reason: ${lossReason}\n${cleanNote}`;

  return `Reason: ${lossReason}`;
}

function resolveInventoryScope(req) {
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

  if (req.user?.canOperateInActiveBranch === false) {
    const e = new Error("BRANCH_OPERATION_DENIED");
    e.code = "BRANCH_OPERATION_DENIED";
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

async function getBranchInventoryMap(tenantId, branchId, productIds) {
  if (!branchId || !Array.isArray(productIds) || productIds.length === 0) {
    return new Map();
  }

  if (!prisma.branchInventory || typeof prisma.branchInventory.findMany !== "function") {
    return new Map();
  }

  const rows = await prisma.branchInventory.findMany({
    where: {
      tenantId,
      branchId,
      productId: { in: productIds },
    },
    select: {
      productId: true,
      qtyOnHand: true,
      qtyReserved: true,
      branchId: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.productId,
      {
        branchId: row.branchId,
        qtyOnHand: Number(row.qtyOnHand || 0),
        qtyReserved: Number(row.qtyReserved || 0),
      },
    ]),
  );
}

function attachBranchStock(products, branchMap, branchId) {
  return products.map((p) => {
    const branchRow = branchMap.get(p.id) || null;

    /*
      Inventory truth:
      - in a single branch view, missing BranchInventory means this branch has 0 sellable stock.
      - in all-branches view, Product.stockQty is the synced tenant-wide total.
    */
    const branchQty = branchId ? Number(branchRow?.qtyOnHand || 0) : null;
    const reservedQty = branchId ? Number(branchRow?.qtyReserved || 0) : null;
    const effectiveQty = branchId ? branchQty : Number(p.stockQty || 0);

    return {
      ...p,
      branchId: branchId || null,
      branchStockQty: branchQty,
      branchReservedQty: reservedQty,
      effectiveStockQty: effectiveQty,
    };
  });
}

function filterProductsByScopeStock(products, { lowStock, outOfStock, threshold }) {
  return products.filter((p) => {
    const qty = Number(p.effectiveStockQty || 0);

    if (outOfStock) return qty === 0;
    if (!lowStock) return true;

    const thresholdToUse = stockThresholdForProduct(p, threshold);
    return qty > 0 && qty <= thresholdToUse;
  });
}

async function createOrSetBranchInventoryIfPossible(tx, { tenantId, branchId, productId, qtyOnHand }) {
  if (!branchId || !tx.branchInventory || typeof tx.branchInventory.findFirst !== "function") {
    return null;
  }

  const existing = await tx.branchInventory.findFirst({
    where: { tenantId, branchId, productId },
    select: { id: true },
  });

  if (existing) {
    return tx.branchInventory.update({
      where: { id: existing.id },
      data: {
        qtyOnHand,
        updatedAt: new Date(),
      },
    });
  }

  return tx.branchInventory.create({
    data: {
      tenantId,
      branchId,
      productId,
      qtyOnHand,
      qtyReserved: 0,
    },
  });
}

async function getOrCreateBranchInventoryTx(tx, { tenantId, branchId, productId }) {
  if (!branchId || !tx.branchInventory || typeof tx.branchInventory.findFirst !== "function") {
    return null;
  }

  const existing = await tx.branchInventory.findFirst({
    where: { tenantId, branchId, productId },
    select: {
      id: true,
      qtyOnHand: true,
      qtyReserved: true,
    },
  });

  if (existing) return existing;

  return tx.branchInventory.create({
    data: {
      tenantId,
      branchId,
      productId,
      qtyOnHand: 0,
      qtyReserved: 0,
    },
    select: {
      id: true,
      qtyOnHand: true,
      qtyReserved: true,
    },
  });
}

async function syncProductTotalStockFromBranchesTx(tx, { tenantId, productId }) {
  if (!tx.branchInventory || typeof tx.branchInventory.aggregate !== "function") {
    return null;
  }

  const aggregate = await tx.branchInventory.aggregate({
    where: {
      tenantId,
      productId,
    },
    _sum: {
      qtyOnHand: true,
    },
  });

  const totalQty = Number(aggregate?._sum?.qtyOnHand || 0);

  await tx.product.update({
    where: { id: productId },
    data: {
      stockQty: totalQty,
    },
  });

  return totalQty;
}

function handleBranchError(res, err) {
  const code = err?.code;
  const msg = String(err?.message || "");

  if (code === "BRANCH_REQUIRED" || msg === "BRANCH_REQUIRED") {
    return res.status(400).json({ message: "No active branch selected", code: "BRANCH_REQUIRED" });
  }
  if (code === "BRANCH_ACCESS_DENIED" || msg === "BRANCH_ACCESS_DENIED") {
    return res.status(403).json({ message: "Branch access denied", code: "BRANCH_ACCESS_DENIED" });
  }
  if (code === "BRANCH_OPERATION_DENIED" || msg === "BRANCH_OPERATION_DENIED") {
    return res.status(403).json({
      message: "You cannot operate in this branch",
      code: "BRANCH_OPERATION_DENIED",
    });
  }
  if (code === "BRANCH_NOT_FOUND" || msg === "BRANCH_NOT_FOUND") {
    return res.status(404).json({ message: "Branch not found", code: "BRANCH_NOT_FOUND" });
  }
  if (code === "BRANCH_NOT_ACTIVE" || msg === "BRANCH_NOT_ACTIVE") {
    return res.status(409).json({ message: "Selected branch is not active", code: "BRANCH_NOT_ACTIVE" });
  }

  return null;
}

async function getProducts(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const limitRaw = toInt(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const cursor = cleanString(req.query.cursor);
  const sort = normalizeSort(req.query.sort);
  const lowStock = cleanBool(req.query.lowStock) === true;
  const outOfStock = cleanBool(req.query.outOfStock) === true;
  const thresholdRaw = toInt(req.query.threshold);
  const threshold =
    Number.isFinite(thresholdRaw) && thresholdRaw >= 0 && thresholdRaw <= 9999
      ? thresholdRaw
      : 5;

  try {
    const scope = resolveInventoryScope(req);
    const where = buildProductWhere(req);
    const orderBy = buildProductOrderBy(sort);

    const products = await prisma.product.findMany({
      where,
      orderBy,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit,
      select: productSelect(),
    });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      products.map((p) => p.id),
    );

    const enriched = attachBranchStock(
      products,
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    const filtered = filterProductsByScopeStock(sortByEffectiveStock(enriched, sort), {
      lowStock,
      outOfStock,
      threshold,
    });

    const nextCursor = products.length === limit ? products[products.length - 1].id : null;

    return res.json({
      products: filtered,
      count: filtered.length,
      nextCursor,
      branchScope: scope,
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch products" });
  }
}

async function searchProducts(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const q = cleanString(req.query.q);
  const limitRaw = toInt(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 20;

  if (!q) return res.json({ products: [], count: 0 });

  try {
    const scope = resolveInventoryScope(req);

    const products = await prisma.product.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { serial: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { subcategory: { contains: q, mode: "insensitive" } },
          { subcategoryOther: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        serial: true,
        barcode: true,
        category: true,
        subcategory: true,
        subcategoryOther: true,
        brand: true,
        minStockLevel: true,
        sellPrice: true,
        stockQty: true,
      },
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      take: limit,
    });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      products.map((p) => p.id),
    );

    const enriched = attachBranchStock(
      products,
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    return res.json({ products: enriched, count: enriched.length, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to search products" });
  }
}

async function getProductById(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id;

  try {
    const scope = resolveInventoryScope(req);

    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      select: productSelect(),
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      [product.id],
    );

    const [enriched] = attachBranchStock(
      [product],
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    return res.json({ ...enriched, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error(err);
    return res.status(500).json({ message: "Failed to fetch product" });
  }
}

async function createProduct(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const activeBranch = await ensureWritableBranchAccessOrThrow(req);
    const data = normalizeProductInput(req.body || {}, { isCreate: true });

    await ensureUniqueProductFields({
      tx: prisma,
      tenantId,
      serial: data.serial,
      barcode: data.barcode,
      sku: data.sku,
    });

    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          tenantId,
          name: data.name,
          sku: data.sku,
          serial: data.serial,
          barcode: data.barcode,
          category: data.category,
          subcategory: data.subcategory,
          subcategoryOther: data.subcategoryOther,
          brand: data.brand,
          minStockLevel: data.minStockLevel,
          costPrice: data.costPrice,
          sellPrice: data.sellPrice,
          stockQty: data.stockQty,
          isActive: true,
        },
        select: productSelect(),
      });

      await createOrSetBranchInventoryIfPossible(tx, {
        tenantId,
        branchId: activeBranch.id,
        productId: product.id,
        qtyOnHand: data.stockQty,
      });

      const syncedTotal = await syncProductTotalStockFromBranchesTx(tx, {
        tenantId,
        productId: product.id,
      });

      await writeAuditLog(tx, {
        tenantId,
        userId,
        branchId: activeBranch.id,
        entity: "PRODUCT",
        entityId: product.id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_CREATED,
        metadata: {
          branchId: activeBranch.id,
          branchCode: activeBranch.code,
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          branchStockQty: data.stockQty,
          stockQty: syncedTotal ?? product.stockQty,
          costPrice: product.costPrice,
          sellPrice: product.sellPrice,
        },
      });

      return tx.product.findFirst({
        where: { id: product.id, tenantId },
        select: productSelect(),
      });
    });

    const branchMap = await getBranchInventoryMap(tenantId, activeBranch.id, [created.id]);
    const [enriched] = attachBranchStock([created], branchMap, activeBranch.id);

    return res.status(201).json({
      ...enriched,
      branchScope: { mode: "SINGLE_BRANCH", branchId: activeBranch.id },
    });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (handleBranchError(res, err)) return;
    if (code === "NAME_REQUIRED" || msg === "NAME_REQUIRED") {
      return res.status(400).json({ message: "name is required" });
    }
    if (code === "INVALID_COST_PRICE" || msg === "INVALID_COST_PRICE") {
      return res.status(400).json({ message: "costPrice must be a non-negative number" });
    }
    if (code === "INVALID_SELL_PRICE" || msg === "INVALID_SELL_PRICE") {
      return res.status(400).json({ message: "sellPrice must be a non-negative number" });
    }
    if (code === "INVALID_STOCK_QTY" || msg === "INVALID_STOCK_QTY") {
      return res.status(400).json({ message: "stockQty must be a non-negative integer" });
    }
    if (code === "INVALID_MIN_STOCK" || msg === "INVALID_MIN_STOCK") {
      return res.status(400).json({ message: "minStockLevel must be 0 or more" });
    }
    if (code === "SERIAL_EXISTS" || msg === "SERIAL_EXISTS") {
      return res.status(400).json({ message: "serial already exists in this tenant" });
    }
    if (code === "BARCODE_EXISTS" || msg === "BARCODE_EXISTS") {
      return res.status(400).json({ message: "barcode already exists in this tenant" });
    }
    if (code === "SKU_EXISTS" || msg === "SKU_EXISTS") {
      return res.status(400).json({ message: "sku already exists in this tenant" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to create product" });
  }
}

async function updateProduct(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id;

  try {
    const data = normalizeProductInput(req.body || {}, { isCreate: false });

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const existing = await prisma.product.findFirst({
      where: { id, tenantId },
      select: productSelect(),
    });

    if (!existing) {
      return res.status(404).json({ message: "Product not found" });
    }

    await ensureUniqueProductFields({
      tx: prisma,
      tenantId,
      id,
      serial: data.serial,
      barcode: data.barcode,
      sku: data.sku,
    });

    const activeBranchId = getActiveBranchId(req);

    const next = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data,
        select: productSelect(),
      });

      await writeAuditLog(tx, {
        tenantId,
        userId,
        branchId: activeBranchId,
        entity: "PRODUCT",
        entityId: updated.id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_UPDATED,
        metadata: {
          branchId: activeBranchId,
          before: {
            name: existing.name,
            sku: existing.sku,
            serial: existing.serial,
            barcode: existing.barcode,
            category: existing.category,
            subcategory: existing.subcategory,
            subcategoryOther: existing.subcategoryOther,
            brand: existing.brand,
            minStockLevel: existing.minStockLevel,
            costPrice: existing.costPrice,
            sellPrice: existing.sellPrice,
          },
          after: {
            name: updated.name,
            sku: updated.sku,
            serial: updated.serial,
            barcode: updated.barcode,
            category: updated.category,
            subcategory: updated.subcategory,
            subcategoryOther: updated.subcategoryOther,
            brand: updated.brand,
            minStockLevel: updated.minStockLevel,
            costPrice: updated.costPrice,
            sellPrice: updated.sellPrice,
          },
        },
      });

      return updated;
    });

    const scope = resolveInventoryScope(req);
    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      [next.id],
    );
    const [enriched] = attachBranchStock(
      [next],
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    return res.json({ ...enriched, branchScope: scope });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (handleBranchError(res, err)) return;
    if (code === "PRODUCT_NOT_FOUND" || msg === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }
    if (code === "NAME_REQUIRED" || msg === "NAME_REQUIRED") {
      return res.status(400).json({ message: "name cannot be empty" });
    }
    if (code === "INVALID_COST_PRICE" || msg === "INVALID_COST_PRICE") {
      return res.status(400).json({ message: "costPrice must be a non-negative number" });
    }
    if (code === "INVALID_SELL_PRICE" || msg === "INVALID_SELL_PRICE") {
      return res.status(400).json({ message: "sellPrice must be a non-negative number" });
    }
    if (code === "INVALID_MIN_STOCK" || msg === "INVALID_MIN_STOCK") {
      return res.status(400).json({ message: "minStockLevel must be 0 or more" });
    }
    if (code === "STOCK_QTY_FORBIDDEN" || msg === "STOCK_QTY_FORBIDDEN") {
      return res.status(400).json({
        message: "Use stock adjustment endpoint to change stock quantity",
      });
    }
    if (code === "SERIAL_EXISTS" || msg === "SERIAL_EXISTS") {
      return res.status(400).json({ message: "serial already exists in this tenant" });
    }
    if (code === "BARCODE_EXISTS" || msg === "BARCODE_EXISTS") {
      return res.status(400).json({ message: "barcode already exists in this tenant" });
    }
    if (code === "SKU_EXISTS" || msg === "SKU_EXISTS") {
      return res.status(400).json({ message: "sku already exists in this tenant" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to update product" });
  }
}

async function deleteProduct(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id;
  const activeBranchId = getActiveBranchId(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, tenantId },
        select: { id: true, isActive: true, name: true },
      });

      if (!existing) {
        const e = new Error("PRODUCT_NOT_FOUND");
        e.code = "PRODUCT_NOT_FOUND";
        throw e;
      }

      if (!existing.isActive) {
        return { alreadyInactive: true };
      }

      await tx.product.update({
        where: { id },
        data: { isActive: false },
      });

      await writeAuditLog(tx, {
        tenantId,
        userId,
        branchId: activeBranchId,
        entity: "PRODUCT",
        entityId: id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
        metadata: { branchId: activeBranchId, name: existing.name },
      });

      return { alreadyInactive: false };
    });

    if (result.alreadyInactive) {
      return res.json({ message: "Product already inactive" });
    }

    return res.json({ message: "Product deactivated" });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (code === "PRODUCT_NOT_FOUND" || msg === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to deactivate product" });
  }
}

async function activateProduct(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id;
  const activeBranchId = getActiveBranchId(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, tenantId },
        select: { id: true, isActive: true, name: true },
      });

      if (!existing) {
        const e = new Error("PRODUCT_NOT_FOUND");
        e.code = "PRODUCT_NOT_FOUND";
        throw e;
      }

      if (existing.isActive) {
        return { alreadyActive: true };
      }

      await tx.product.update({
        where: { id },
        data: { isActive: true },
      });

      await writeAuditLog(tx, {
        tenantId,
        userId,
        branchId: activeBranchId,
        entity: "PRODUCT",
        entityId: id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_ACTIVATED,
        metadata: { branchId: activeBranchId, name: existing.name },
      });

      return { alreadyActive: false };
    });

    if (result.alreadyActive) {
      return res.json({ message: "Product already active" });
    }

    return res.json({ message: "Product activated" });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (code === "PRODUCT_NOT_FOUND" || msg === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }

    console.error(err);
    return res.status(500).json({ message: "Failed to activate product" });
  }
}

async function adjustStock(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const userId = getUserId(req);
    const userRole = String(req.user?.role || "").toUpperCase();
    const activeBranch = await ensureWritableBranchAccessOrThrow(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const productId = String(req.params.id || "");
    const type = normalizeAdjustmentType(req.body.type);
    const rawNote = cleanString(req.body.note);
    const lossReason = normalizeLossReason(req.body.lossReason);

    if (!productId) {
      return res.status(400).json({ message: "Missing product id" });
    }

    if (!type) {
      return res.status(400).json({
        message: "Invalid type. Use RESTOCK, LOSS, or CORRECTION.",
      });
    }

    if (type === "LOSS" && !lossReason) {
      return res.status(400).json({
        message:
          "LOSS requires lossReason. Use one of: STOLEN, DAMAGED, LOST, EXPIRED, INTERNAL_USE, COUNTING_ERROR, OTHER.",
        code: "LOSS_REASON_REQUIRED",
      });
    }

    if (type === "LOSS" && (lossReason === "STOLEN" || lossReason === "OTHER") && !rawNote) {
      return res.status(400).json({
        message: "A note is required when lossReason is STOLEN or OTHER.",
        code: "LOSS_NOTE_REQUIRED",
      });
    }

    const note = buildStockAdjustmentNote({
      type,
      lossReason,
      note: rawNote,
    });

    const isOwner = userRole === "OWNER";

    if (!isOwner) {
      if (type === "RESTOCK" && !hasDbPermission(req, "stock.restock")) {
        return res.status(403).json({
          message: "Forbidden",
          code: "MISSING_PERMISSION",
          requiredPermission: "stock.restock",
        });
      }

      if (type === "LOSS" && !hasDbPermission(req, "stock.loss")) {
        return res.status(403).json({
          message: "Forbidden",
          code: "MISSING_PERMISSION",
          requiredPermission: "stock.loss",
        });
      }

      if (type === "CORRECTION" && !hasDbPermission(req, "stock.correction")) {
        return res.status(403).json({
          message: "Forbidden",
          code: "MISSING_PERMISSION",
          requiredPermission: "stock.correction",
        });
      }
    }

    const quantity = toInt(req.body.quantity);
    const newStockQty = toInt(req.body.newStockQty);

    if (type === "RESTOCK" || type === "LOSS") {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({
          message: "quantity must be a positive number",
        });
      }
    }

    if (type === "CORRECTION") {
      if (!Number.isInteger(newStockQty) || newStockQty < 0) {
        return res.status(400).json({
          message: "newStockQty must be 0 or more",
        });
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: productId, tenantId },
          select: {
            id: true,
            name: true,
            stockQty: true,
            sku: true,
            barcode: true,
            serial: true,
          },
        });

        if (!product) {
          throw new Error("PRODUCT_NOT_FOUND");
        }

        const branchInventory = await getOrCreateBranchInventoryTx(tx, {
          tenantId,
          branchId: activeBranch.id,
          productId: product.id,
        });

        if (!branchInventory) {
          throw new Error("BRANCH_INVENTORY_UNAVAILABLE");
        }

        const beforeQtyBranch = Number(branchInventory.qtyOnHand || 0);

        let delta = 0;
        let afterQty = beforeQtyBranch;

        if (type === "RESTOCK") {
          delta = quantity;
          afterQty = beforeQtyBranch + quantity;
        } else if (type === "LOSS") {
          delta = -quantity;
          afterQty = beforeQtyBranch - quantity;
        } else {
          delta = newStockQty - beforeQtyBranch;
          afterQty = newStockQty;
        }

        if (afterQty < 0) {
          throw new Error("NEGATIVE_STOCK");
        }

        await tx.branchInventory.update({
          where: { id: branchInventory.id },
          data: {
            qtyOnHand: afterQty,
            updatedAt: new Date(),
          },
        });

        const globalAfterQty = await syncProductTotalStockFromBranchesTx(tx, {
          tenantId,
          productId: product.id,
        });

        const adj = await tx.stockAdjustment.create({
          data: {
            tenantId,
            branchId: activeBranch.id,
            productId: product.id,
            type,
            delta,
            beforeQty: beforeQtyBranch,
            afterQty,
            note: note || null,
            createdById: userId || null,
          },
          select: {
            id: true,
            branchId: true,
            type: true,
            delta: true,
            beforeQty: true,
            afterQty: true,
            note: true,
            createdAt: true,
          },
        });

        await writeAuditLog(tx, {
          tenantId,
          userId,
          branchId: activeBranch.id,
          entity: "PRODUCT",
          entityId: product.id,
          action: INVENTORY_AUDIT_ACTIONS.PRODUCT_UPDATED,
          metadata: {
            event: "STOCK_ADJUSTED",
            adjustmentId: adj.id,
            branchId: activeBranch.id,
            branchCode: activeBranch.code,
            productId: product.id,
            productName: product.name,
            type,
            delta,
            beforeQty: beforeQtyBranch,
            afterQty,
            globalAfterQty,
            lossReason: type === "LOSS" ? lossReason : null,
            note: note || null,
          },
        });

        return {
          productId: product.id,
          productName: product.name,
          branchId: activeBranch.id,
          branchCode: activeBranch.code,
          beforeQty: beforeQtyBranch,
          afterQty,
          delta,
          type,
          adjustmentId: adj.id,
          lossReason: type === "LOSS" ? lossReason : null,
          globalAfterQty,
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      },
    );

    return res.status(201).json({
      message: "Stock updated",
      ...result,
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (handleBranchError(res, err)) return;

    if (msg === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }

    if (msg === "NEGATIVE_STOCK") {
      return res.status(400).json({ message: "Stock cannot go below 0" });
    }

    if (msg === "BRANCH_INVENTORY_UNAVAILABLE") {
      return res.status(500).json({
        message: "Branch inventory is not available",
        code: "BRANCH_INVENTORY_UNAVAILABLE",
      });
    }

    if (err?.code === "P2028") {
      return res.status(503).json({
        message: "Stock update transaction timed out. Please retry.",
        code: "STOCK_TRANSACTION_TIMEOUT",
      });
    }

    console.error("adjustStock error:", err);
    return res.status(500).json({ message: "Failed to adjust stock" });
  }
}

async function listStockAdjustments(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);
    const productId = String(req.params.id || "");
    if (!productId) return res.status(400).json({ message: "Missing product id" });

    const rows = await prisma.stockAdjustment.findMany({
      where: {
        tenantId,
        productId,
        ...(scope.mode === "SINGLE_BRANCH" && scope.branchId ? { branchId: scope.branchId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        branchId: true,
        type: true,
        delta: true,
        beforeQty: true,
        afterQty: true,
        note: true,
        createdAt: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });

    return res.json({ adjustments: rows, branchScope: scope });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("listStockAdjustments error:", err);
    return res.status(500).json({ message: "Failed to load stock history" });
  }
}

async function listAllStockAdjustments(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);
    const q = cleanString(req.query.q);
    const type = normalizeAdjustmentType(req.query.type);

    const from = parseDateOnly(req.query.from);
    const to = parseDateOnly(req.query.to);

    const limitRaw = toInt(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

    const now = new Date();
    const start = from
      ? startOfDay(from)
      : startOfDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const end = to ? endOfDay(to) : endOfDay(now);

    const where = {
      tenantId,
      createdAt: { gte: start, lte: end },
      ...(scope.mode === "SINGLE_BRANCH" && scope.branchId ? { branchId: scope.branchId } : {}),
    };

    if (type) where.type = type;

    if (q) {
      where.product = {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { serial: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    const rows = await prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        branchId: true,
        type: true,
        delta: true,
        beforeQty: true,
        afterQty: true,
        note: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            barcode: true,
            minStockLevel: true,
          },
        },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });

    return res.json({
      range: { from: start.toISOString(), to: end.toISOString() },
      count: rows.length,
      adjustments: rows,
      branchScope: scope,
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("listAllStockAdjustments error:", err);
    return res.status(500).json({ message: "Failed to load stock adjustments" });
  }
}

async function getInventorySummary(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);

    const products = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        stockQty: true,
        costPrice: true,
        sellPrice: true,
        minStockLevel: true,
      },
    });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      products.map((p) => p.id),
    );

    const enriched = attachBranchStock(
      products,
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    let totalActiveProducts = 0;
    let totalStockUnits = 0;
    let outOfStockCount = 0;
    let lowStockCount = 0;
    let stockCostValue = 0;
    let stockSellValue = 0;

    for (const p of enriched) {
      totalActiveProducts += 1;

      const qty = Number(p.effectiveStockQty || 0);
      const cost = Number(p.costPrice || 0);
      const sell = Number(p.sellPrice || 0);
      const minStockLevel = Number.isFinite(Number(p.minStockLevel))
        ? Number(p.minStockLevel)
        : null;

      totalStockUnits += qty;
      stockCostValue += qty * cost;
      stockSellValue += qty * sell;

      if (qty === 0) {
        outOfStockCount += 1;
      } else if (minStockLevel != null && qty <= minStockLevel) {
        lowStockCount += 1;
      }
    }

    return res.json({
      branchScope: scope,
      summary: {
        totalActiveProducts,
        totalStockUnits,
        outOfStockCount,
        lowStockCount,
        stockCostValue,
        stockSellValue,
      },
    });
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("getInventorySummary error:", err);
    return res.status(500).json({ message: "Failed to load inventory summary" });
  }
}

async function reorderPdf(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);
    const thresholdRaw = toInt(req.query.threshold);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0 && thresholdRaw <= 9999
        ? thresholdRaw
        : 5;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, phone: true, email: true },
    });

    const allActiveProducts = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        subcategoryOther: true,
        brand: true,
        sku: true,
        barcode: true,
        sellPrice: true,
        stockQty: true,
        minStockLevel: true,
      },
      take: 1000,
    });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      allActiveProducts.map((p) => p.id),
    );

    const enriched = attachBranchStock(
      allActiveProducts,
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    const outOfStock = enriched.filter((p) => Number(p.effectiveStockQty || 0) === 0);

    const lowStock = enriched.filter((p) => {
      const qty = Number(p.effectiveStockQty || 0);
      if (qty <= 0) return false;
      const thresholdToUse = stockThresholdForProduct(p, threshold);
      return qty <= thresholdToUse;
    });

    const scopeLine =
      scope.mode === "SINGLE_BRANCH" && scope.branchId
        ? `Branch scope: ${scope.branchId}`
        : "Branch scope: All branches";

    const storeLine = [tenant?.name, tenant?.phone, tenant?.email].filter(Boolean).join(" • ");
    const filename = `storvex-reorder-${isoDate(new Date())}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    const M = doc.page.margins.left;
    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const contentW = pageW - M * 2;

    function thresholdText(p) {
      return String(stockThresholdForProduct(p, threshold));
    }

    function drawHeader() {
      doc.save();
      doc.rect(0, 0, pageW, 92).fill("#0f172a");
      doc.restore();

      doc.fillColor("#ffffff");
      doc.font("Helvetica-Bold").fontSize(20).text("Storvex", M, 22);
      doc.font("Helvetica-Bold").fontSize(16).text("Reorder List", M, 46);

      doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1");
      doc.text(storeLine ? `Store: ${storeLine}` : "Store: —", M, 68);

      doc.fillColor("#0f172a");
      doc.rect(M, 98, contentW, 1).fill("#e2e8f0");

      doc.fillColor("#0f172a").font("Helvetica");
      doc.y = 114;
    }

    function drawFooter() {
      const y = pageH - doc.page.margins.bottom - 14;
      doc.font("Helvetica").fontSize(8).fillColor("#94a3b8");
      doc.text("Storvex • Reorder List", M, y, { align: "left" });
      doc.text(`Page ${doc.page.number}`, M, y, { align: "right" });
      doc.fillColor("#0f172a");
    }

    function ensureSpace(pxNeeded) {
      const bottomLimit = pageH - doc.page.margins.bottom - 22;
      if (doc.y + pxNeeded > bottomLimit) {
        drawFooter();
        doc.addPage();
        drawHeader();
      }
    }

    function drawMiniStats() {
      ensureSpace(94);

      doc.font("Helvetica").fontSize(10).fillColor("#334155");
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.text(`Default low stock level: ${threshold}`);
      doc.text(scopeLine);
      doc.moveDown(0.8);

      const gap = 12;
      const cardW = (contentW - gap * 2) / 3;
      const cardH = 62;
      const y = doc.y;

      function card(x, title, value, tone) {
        const toneColor = tone === "danger" ? "#dc2626" : tone === "warning" ? "#d97706" : "#16a34a";

        doc.save();
        doc.roundedRect(x, y, cardW, cardH, 10).fill("#ffffff").stroke("#e2e8f0");
        doc.restore();

        doc.save();
        doc.roundedRect(x, y, 8, cardH, 10).fill(toneColor);
        doc.restore();

        doc.fillColor("#475569").font("Helvetica").fontSize(10).text(title, x + 16, y + 10, { width: cardW - 24 });
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text(String(value), x + 16, y + 28, { width: cardW - 24 });

        doc.fillColor("#0f172a").font("Helvetica");
      }

      card(M, "Out of stock", outOfStock.length, "danger");
      card(M + cardW + gap, "Low stock", lowStock.length, "warning");
      card(M + (cardW + gap) * 2, "Default threshold", threshold, "warning");

      doc.y = y + cardH + 18;
    }

    function drawTable(title, rows) {
      ensureSpace(40);

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(title);
      doc.moveDown(0.4);

      if (!rows.length) {
        doc.font("Helvetica").fontSize(10).fillColor("#64748b").text("No items.");
        doc.fillColor("#0f172a");
        doc.moveDown(0.8);
        return;
      }

      const x = M;
      const w = contentW;

      const colName = Math.floor(w * 0.42);
      const colCat = Math.floor(w * 0.24);
      const colStock = Math.floor(w * 0.10);
      const colMin = Math.floor(w * 0.10);
      const colPrice = w - colName - colCat - colStock - colMin;

      const headerH = 22;
      const rowH = 22;

      function drawHeaderRow() {
        ensureSpace(headerH + 6);

        const y = doc.y;

        doc.save();
        doc.roundedRect(x, y, w, headerH, 8).fill("#f1f5f9").stroke("#e2e8f0");
        doc.restore();

        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(10);
        doc.text("Product", x + 8, y + 6, { width: colName - 16 });
        doc.text("Category", x + colName + 8, y + 6, { width: colCat - 16 });
        doc.text("Stock", x + colName + colCat, y + 6, { width: colStock - 8, align: "center" });
        doc.text("Min", x + colName + colCat + colStock, y + 6, { width: colMin - 8, align: "center" });
        doc.text("Sell", x + colName + colCat + colStock + colMin, y + 6, { width: colPrice - 8, align: "right" });

        doc.font("Helvetica").fillColor("#0f172a");
        doc.y = y + headerH;
      }

      drawHeaderRow();

      for (let i = 0; i < rows.length; i++) {
        ensureSpace(rowH + 6);

        const r = rows[i];
        const y = doc.y;

        doc.save();
        doc.rect(x, y, w, rowH).fill(i % 2 === 0 ? "#ffffff" : "#fbfdff").stroke("#e2e8f0");
        doc.restore();

        doc.fillColor("#0f172a").fontSize(10);
        doc.text(r.name || "—", x + 8, y + 6, { width: colName - 16 });

        doc.fillColor("#334155");
        doc.text(categoryText(r), x + colName + 8, y + 6, { width: colCat - 16 });

        doc.fillColor("#0f172a");
        doc.text(String(r.effectiveStockQty ?? 0), x + colName + colCat, y + 6, { width: colStock - 8, align: "center" });
        doc.text(thresholdText(r), x + colName + colCat + colStock, y + 6, { width: colMin - 8, align: "center" });

        doc.text(formatRwf(r.sellPrice), x + colName + colCat + colStock + colMin, y + 6, {
          width: colPrice - 8,
          align: "right",
        });

        doc.y = y + rowH;

        const bottomLimit = pageH - doc.page.margins.bottom - 22;
        if (doc.y > bottomLimit) {
          drawFooter();
          doc.addPage();
          drawHeader();
          ensureSpace(30);
          doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(title);
          doc.moveDown(0.4);
          drawHeaderRow();
        }
      }

      doc.moveDown(0.8);
    }

    drawHeader();
    drawMiniStats();
    drawTable("Out of stock", outOfStock);
    drawTable("Low stock", lowStock);
    drawFooter();

    doc.end();
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("reorderPdf error:", err);
    return res.status(500).json({ message: "Failed to export reorder PDF" });
  }
}

async function exportInventoryExcel(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);
    const sort = normalizeSort(req.query.sort);
    const lowStock = cleanBool(req.query.lowStock) === true;
    const outOfStock = cleanBool(req.query.outOfStock) === true;
    const thresholdRaw = toInt(req.query.threshold);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 0 && thresholdRaw <= 9999
        ? thresholdRaw
        : 5;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    const products = await prisma.product.findMany({
      where: buildProductWhere(req),
      orderBy: buildProductOrderBy(sort),
      take: 5000,
      select: productSelect(),
    });

    const branchMap = await getBranchInventoryMap(
      tenantId,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
      products.map((p) => p.id),
    );

    const enriched = attachBranchStock(
      products,
      branchMap,
      scope.mode === "SINGLE_BRANCH" ? scope.branchId : null,
    );

    const filtered = filterProductsByScopeStock(sortByEffectiveStock(enriched, sort), {
      lowStock,
      outOfStock,
      threshold,
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Storvex";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Inventory");

    ws.properties.defaultRowHeight = 20;
    ws.views = [{ state: "frozen", ySplit: 1 }];

    makeWorkbookHeaderRow(ws, [
      "Product Name",
      "Brand",
      "Category",
      "SKU",
      "Barcode",
      "Serial / IMEI",
      "Buy Price",
      "Sell Price",
      "Stock Qty",
      "Branch Stock Qty",
      "Min Stock Level",
      "Stock Status",
      "Active",
      "Created At",
    ]);

    for (const p of filtered) {
      const qty = Number(p.effectiveStockQty || 0);
      const thresholdToUse = stockThresholdForProduct(p, threshold);

      let stockStatus = "Healthy";
      if (qty === 0) stockStatus = "Out of stock";
      else if (qty <= thresholdToUse) stockStatus = "Low stock";

      ws.addRow([
        p.name || "",
        p.brand || "",
        categoryText(p),
        p.sku || "",
        p.barcode || "",
        p.serial || "",
        Number(p.costPrice || 0),
        Number(p.sellPrice || 0),
        qty,
        p.branchStockQty == null ? "" : Number(p.branchStockQty || 0),
        thresholdToUse,
        stockStatus,
        p.isActive ? "Yes" : "No",
        p.createdAt ? new Date(p.createdAt).toLocaleString() : "",
      ]);
    }

    ws.insertRow(1, [
      tenant?.name ? `${tenant.name} Inventory Export` : "Inventory Export",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `Generated ${new Date().toLocaleString()}`,
    ]);
    ws.mergeCells("A1:M1");
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { vertical: "middle" };
    ws.getCell("N1").font = { italic: true, size: 10 };
    ws.getRow(1).height = 22;

    ws.getColumn(7).numFmt = '#,##0 "RWF"';
    ws.getColumn(8).numFmt = '#,##0 "RWF"';

    styleDataRows(ws);
    autosizeWorksheet(ws);

    const filename = `storvex-inventory-${isoDate(new Date())}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("exportInventoryExcel error:", err);
    return res.status(500).json({ message: "Failed to export inventory Excel" });
  }
}

async function exportStockAdjustmentsExcel(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const scope = resolveInventoryScope(req);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    const q = cleanString(req.query.q);
    const type = normalizeAdjustmentType(req.query.type);
    const from = parseDateOnly(req.query.from);
    const to = parseDateOnly(req.query.to);

    const now = new Date();
    const start = from
      ? startOfDay(from)
      : startOfDay(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const end = to ? endOfDay(to) : endOfDay(now);

    const where = {
      tenantId,
      createdAt: { gte: start, lte: end },
      ...(scope.mode === "SINGLE_BRANCH" && scope.branchId ? { branchId: scope.branchId } : {}),
    };

    if (type) where.type = type;

    if (q) {
      where.product = {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { sku: { contains: q, mode: "insensitive" } },
          { serial: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
        ],
      };
    }

    const rows = await prisma.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10000,
      select: {
        id: true,
        branchId: true,
        type: true,
        delta: true,
        beforeQty: true,
        afterQty: true,
        note: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            category: true,
          },
        },
        branch: {
          select: {
            name: true,
            code: true,
          },
        },
        createdBy: { select: { name: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Storvex";
    workbook.created = new Date();

    const ws = workbook.addWorksheet("Stock History");
    ws.properties.defaultRowHeight = 20;
    ws.views = [{ state: "frozen", ySplit: 1 }];

    makeWorkbookHeaderRow(ws, [
      "Date",
      "Branch",
      "Product",
      "SKU",
      "Barcode",
      "Category",
      "Type",
      "Delta",
      "Before Qty",
      "After Qty",
      "Changed By",
      "Note",
    ]);

    for (const row of rows) {
      ws.addRow([
        row.createdAt ? new Date(row.createdAt).toLocaleString() : "",
        row.branch?.code || row.branch?.name || "",
        row.product?.name || "",
        row.product?.sku || "",
        row.product?.barcode || "",
        row.product?.category || "",
        row.type || "",
        Number(row.delta || 0),
        Number(row.beforeQty || 0),
        Number(row.afterQty || 0),
        row.createdBy?.name || "System",
        row.note || "",
      ]);
    }

    ws.insertRow(1, [
      tenant?.name ? `${tenant.name} Stock History Export` : "Stock History Export",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      `Generated ${new Date().toLocaleString()}`,
    ]);
    ws.mergeCells("A1:K1");
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { vertical: "middle" };
    ws.getCell("L1").font = { italic: true, size: 10 };
    ws.getRow(1).height = 22;

    styleDataRows(ws);
    autosizeWorksheet(ws);

    const filename = `storvex-stock-history-${isoDate(new Date())}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    if (handleBranchError(res, err)) return;

    console.error("exportStockAdjustmentsExcel error:", err);
    return res.status(500).json({ message: "Failed to export stock history Excel" });
  }
}

module.exports = {
  getProducts,
  searchProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  activateProduct,
  adjustStock,
  listStockAdjustments,
  listAllStockAdjustments,
  getInventorySummary,
  reorderPdf,
  exportInventoryExcel,
  exportStockAdjustmentsExcel,
};