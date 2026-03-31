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

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
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

async function writeAuditLog(tx, { tenantId, userId, entity, entityId, action, metadata }) {
  try {
    if (!Object.values(INVENTORY_AUDIT_ACTIONS).includes(action)) {
      return;
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
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
  const outOfStock = cleanBool(req.query.outOfStock) === true;
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

  if (outOfStock) where.stockQty = 0;

  return where;
}

function buildProductOrderBy(sort) {
  let orderBy = [{ createdAt: "desc" }];
  if (sort === "name") orderBy = [{ name: "asc" }, { createdAt: "desc" }];
  if (sort === "stock_low") orderBy = [{ stockQty: "asc" }, { createdAt: "desc" }];
  if (sort === "stock_high") orderBy = [{ stockQty: "desc" }, { createdAt: "desc" }];
  return orderBy;
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

  if (cleanNote) {
    return `Reason: ${lossReason}\n${cleanNote}`;
  }

  return `Reason: ${lossReason}`;
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

  const where = buildProductWhere(req);
  const orderBy = buildProductOrderBy(sort);

  try {
    const products = await prisma.product.findMany({
      where,
      orderBy,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit,
      select: productSelect(),
    });

    const filtered = products.filter((p) => {
      if (outOfStock) return Number(p.stockQty || 0) === 0;
      if (!lowStock) return true;

      const thresholdToUse = stockThresholdForProduct(p, threshold);
      return Number(p.stockQty || 0) > 0 && Number(p.stockQty || 0) <= thresholdToUse;
    });

    const nextCursor = products.length === limit ? products[products.length - 1].id : null;

    return res.json({
      products: filtered,
      count: filtered.length,
      nextCursor,
    });
  } catch (err) {
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

    return res.json({ products, count: products.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to search products" });
  }
}

async function getProductById(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  const id = req.params.id;

  try {
    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      select: productSelect(),
    });

    if (!product) return res.status(404).json({ message: "Product not found" });

    return res.json(product);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch product" });
  }
}

async function createProduct(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const data = normalizeProductInput(req.body || {}, { isCreate: true });

    const product = await prisma.$transaction(async (tx) => {
      await ensureUniqueProductFields({
        tx,
        tenantId,
        serial: data.serial,
        barcode: data.barcode,
        sku: data.sku,
      });

      const created = await tx.product.create({
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

      await writeAuditLog(tx, {
        tenantId,
        userId,
        entity: "PRODUCT",
        entityId: created.id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_CREATED,
        metadata: {
          name: created.name,
          sku: created.sku,
          barcode: created.barcode,
          stockQty: created.stockQty,
          costPrice: created.costPrice,
          sellPrice: created.sellPrice,
        },
      });

      return created;
    });

    return res.status(201).json(product);
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

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

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, tenantId },
        select: productSelect(),
      });

      if (!existing) {
        const e = new Error("PRODUCT_NOT_FOUND");
        e.code = "PRODUCT_NOT_FOUND";
        throw e;
      }

      await ensureUniqueProductFields({
        tx,
        tenantId,
        id,
        serial: data.serial,
        barcode: data.barcode,
        sku: data.sku,
      });

      const next = await tx.product.update({
        where: { id },
        data,
        select: productSelect(),
      });

      await writeAuditLog(tx, {
        tenantId,
        userId,
        entity: "PRODUCT",
        entityId: next.id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_UPDATED,
        metadata: {
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
            name: next.name,
            sku: next.sku,
            serial: next.serial,
            barcode: next.barcode,
            category: next.category,
            subcategory: next.subcategory,
            subcategoryOther: next.subcategoryOther,
            brand: next.brand,
            minStockLevel: next.minStockLevel,
            costPrice: next.costPrice,
            sellPrice: next.sellPrice,
          },
        },
      });

      return next;
    });

    return res.json(updated);
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

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
        entity: "PRODUCT",
        entityId: id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_DEACTIVATED,
        metadata: { name: existing.name },
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
        entity: "PRODUCT",
        entityId: id,
        action: INVENTORY_AUDIT_ACTIONS.PRODUCT_ACTIVATED,
        metadata: { name: existing.name },
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
      return res
        .status(400)
        .json({ message: "Invalid type. Use RESTOCK, LOSS, or CORRECTION." });
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

    const result = await prisma.$transaction(async (tx) => {
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

      const beforeQty = Number(product.stockQty || 0);

      let delta = 0;
      let afterQty = beforeQty;

      if (type === "RESTOCK") {
        delta = quantity;
        afterQty = beforeQty + quantity;
      } else if (type === "LOSS") {
        delta = -quantity;
        afterQty = beforeQty - quantity;
      } else {
        delta = newStockQty - beforeQty;
        afterQty = newStockQty;
      }

      if (afterQty < 0) {
        throw new Error("NEGATIVE_STOCK");
      }

      await tx.product.update({
        where: { id: product.id },
        data: { stockQty: afterQty },
      });

      const adj = await tx.stockAdjustment.create({
        data: {
          tenantId,
          productId: product.id,
          type,
          delta,
          beforeQty,
          afterQty,
          note: note || null,
          createdById: userId || null,
        },
        select: {
          id: true,
          type: true,
          delta: true,
          beforeQty: true,
          afterQty: true,
          note: true,
          createdAt: true,
        },
      });

      return {
        productId: product.id,
        productName: product.name,
        beforeQty,
        afterQty,
        delta,
        type,
        adjustmentId: adj.id,
        lossReason: type === "LOSS" ? lossReason : null,
      };
    });

    return res.status(201).json({
      message: "Stock updated",
      ...result,
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (msg === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Product not found" });
    }

    if (msg === "NEGATIVE_STOCK") {
      return res.status(400).json({ message: "Stock cannot go below 0" });
    }

    console.error("adjustStock error:", err);
    return res.status(500).json({ message: "Failed to adjust stock" });
  }
}

async function listStockAdjustments(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const productId = String(req.params.id || "");
    if (!productId) return res.status(400).json({ message: "Missing product id" });

    const rows = await prisma.stockAdjustment.findMany({
      where: { tenantId, productId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        type: true,
        delta: true,
        beforeQty: true,
        afterQty: true,
        note: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });

    return res.json({ adjustments: rows });
  } catch (err) {
    console.error("listStockAdjustments error:", err);
    return res.status(500).json({ message: "Failed to load stock history" });
  }
}

async function listAllStockAdjustments(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

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
        createdBy: { select: { name: true } },
      },
    });

    return res.json({
      range: { from: start.toISOString(), to: end.toISOString() },
      count: rows.length,
      adjustments: rows,
    });
  } catch (err) {
    console.error("listAllStockAdjustments error:", err);
    return res.status(500).json({ message: "Failed to load stock adjustments" });
  }
}

async function getInventorySummary(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

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

    let totalActiveProducts = 0;
    let totalStockUnits = 0;
    let outOfStockCount = 0;
    let lowStockCount = 0;
    let stockCostValue = 0;
    let stockSellValue = 0;

    for (const p of products) {
      totalActiveProducts += 1;

      const qty = Number(p.stockQty || 0);
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
    console.error("getInventorySummary error:", err);
    return res.status(500).json({ message: "Failed to load inventory summary" });
  }
}

async function reorderPdf(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

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

    const outOfStock = allActiveProducts.filter((p) => Number(p.stockQty || 0) === 0);

    const lowStock = allActiveProducts.filter((p) => {
      const qty = Number(p.stockQty || 0);
      if (qty <= 0) return false;
      const thresholdToUse = stockThresholdForProduct(p, threshold);
      return qty <= thresholdToUse;
    });

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
      ensureSpace(80);

      doc.font("Helvetica").fontSize(10).fillColor("#334155");
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.text(`Default low stock level: ${threshold}`);
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
        doc.text(String(r.stockQty ?? 0), x + colName + colCat, y + 6, { width: colStock - 8, align: "center" });
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
    console.error("reorderPdf error:", err);
    return res.status(500).json({ message: "Failed to export reorder PDF" });
  }
}

async function exportInventoryExcel(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

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

    const filtered = products.filter((p) => {
      if (outOfStock) return Number(p.stockQty || 0) === 0;
      if (!lowStock) return true;

      const thresholdToUse = stockThresholdForProduct(p, threshold);
      return Number(p.stockQty || 0) > 0 && Number(p.stockQty || 0) <= thresholdToUse;
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
      "Min Stock Level",
      "Stock Status",
      "Active",
      "Created At",
    ]);

    for (const p of filtered) {
      const qty = Number(p.stockQty || 0);
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
      `Generated ${new Date().toLocaleString()}`,
    ]);
    ws.mergeCells("A1:L1");
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { vertical: "middle" };
    ws.getCell("M1").font = { italic: true, size: 10 };
    ws.getRow(1).height = 22;

    ws.getColumn(7).numFmt = '#,##0 "RWF"';
    ws.getColumn(8).numFmt = '#,##0 "RWF"';

    styleDataRows(ws);
    autosizeWorksheet(ws);

    const filename = `storvex-inventory-${isoDate(new Date())}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("exportInventoryExcel error:", err);
    return res.status(500).json({ message: "Failed to export inventory Excel" });
  }
}

async function exportStockAdjustmentsExcel(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

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
      `Generated ${new Date().toLocaleString()}`,
    ]);
    ws.mergeCells("A1:J1");
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.getCell("A1").alignment = { vertical: "middle" };
    ws.getCell("K1").font = { italic: true, size: 10 };
    ws.getRow(1).height = 22;

    styleDataRows(ws);
    autosizeWorksheet(ws);

    const filename = `storvex-stock-history-${isoDate(new Date())}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
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