const prisma = require("../../config/database");

// small helpers
function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}
function toInt(x, fallback = NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function toMoney(x, fallback = NaN) {
  const n = typeof x === "string" ? Number(x.trim()) : Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function getTenantId(req) {
  return req.user?.tenantId || null;
}

const ID_TYPES = new Set(["NATIONAL_ID", "PASSPORT"]);
const SUPPLIER_SOURCE_TYPES = new Set(["BOUGHT", "GIFT", "TRADE_IN", "CONSIGNMENT", "OTHER"]);
const SUPPLY_SOURCE_TYPES = new Set(["BOUGHT", "GIFT", "TRADE_IN", "CONSIGNMENT", "OTHER"]);

function normalizeIdType(v) {
  const x = String(v || "").trim().toUpperCase();
  return ID_TYPES.has(x) ? x : null;
}
function normalizeSupplierSourceType(v) {
  const x = String(v || "").trim().toUpperCase();
  return SUPPLIER_SOURCE_TYPES.has(x) ? x : "OTHER";
}
function normalizeSupplySourceType(v) {
  const x = String(v || "").trim().toUpperCase();
  return SUPPLY_SOURCE_TYPES.has(x) ? x : "OTHER";
}

// -----------------------
// GET /api/suppliers
// -----------------------
async function listSuppliers(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const q = cleanString(req.query.q);
    const activeRaw = cleanString(req.query.active);
    const active = activeRaw == null ? true : String(activeRaw).toLowerCase() === "true";

    const where = { tenantId, isActive: active };
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { idNumber: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { companyName: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.supplier.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        isActive: true,
        companyName: true,
        sourceType: true,
        createdAt: true,
      },
    });

    return res.json({ suppliers: rows, count: rows.length });
  } catch (err) {
    console.error("listSuppliers error:", err);
    return res.status(500).json({ message: "Failed to load suppliers" });
  }
}

// -----------------------
// POST /api/suppliers
// -----------------------
async function createSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const name = cleanString(req.body.name);
    const idType = normalizeIdType(req.body.idType);
    const idNumber = cleanString(req.body.idNumber);

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!idType) return res.status(400).json({ message: "idType must be NATIONAL_ID or PASSPORT" });
    if (!idNumber) return res.status(400).json({ message: "idNumber is required" });

    const data = {
      tenantId,
      name,
      idType,
      idNumber,
      phone: cleanString(req.body.phone),
      email: cleanString(req.body.email),
      address: cleanString(req.body.address),
      notes: cleanString(req.body.notes),
      companyName: cleanString(req.body.companyName),
      taxId: cleanString(req.body.taxId),
      sourceType: normalizeSupplierSourceType(req.body.sourceType),
      sourceDetails: cleanString(req.body.sourceDetails),
      isActive: true,
    };

    const created = await prisma.supplier.create({
      data,
      select: { id: true, name: true, idType: true, idNumber: true, createdAt: true },
    });

    return res.status(201).json({ created: true, supplier: created });
  } catch (err) {
    // common unique error
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return res.status(400).json({ message: "This ID is already used for another supplier in this store." });
    }
    console.error("createSupplier error:", err);
    return res.status(500).json({ message: "Failed to create supplier" });
  }
}

// -----------------------
// GET /api/suppliers/:id
// -----------------------
async function getSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = String(req.params.id || "");
    const supplier = await prisma.supplier.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        companyName: true,
        taxId: true,
        sourceType: true,
        sourceDetails: true,
        verifiedAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!supplier) return res.status(404).json({ message: "Supplier not found" });
    return res.json(supplier);
  } catch (err) {
    console.error("getSupplier error:", err);
    return res.status(500).json({ message: "Failed to load supplier" });
  }
}

// -----------------------
// PUT /api/suppliers/:id
// -----------------------
async function updateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = String(req.params.id || "");

    const data = {};
    if (req.body.name != null) data.name = cleanString(req.body.name);
    if (req.body.phone != null) data.phone = cleanString(req.body.phone);
    if (req.body.email != null) data.email = cleanString(req.body.email);
    if (req.body.address != null) data.address = cleanString(req.body.address);
    if (req.body.notes != null) data.notes = cleanString(req.body.notes);
    if (req.body.companyName != null) data.companyName = cleanString(req.body.companyName);
    if (req.body.taxId != null) data.taxId = cleanString(req.body.taxId);

    if (req.body.idType != null) {
      const t = normalizeIdType(req.body.idType);
      if (!t) return res.status(400).json({ message: "idType must be NATIONAL_ID or PASSPORT" });
      data.idType = t;
    }
    if (req.body.idNumber != null) {
      const n = cleanString(req.body.idNumber);
      if (!n) return res.status(400).json({ message: "idNumber cannot be empty" });
      data.idNumber = n;
    }

    if (req.body.sourceType != null) data.sourceType = normalizeSupplierSourceType(req.body.sourceType);
    if (req.body.sourceDetails != null) data.sourceDetails = cleanString(req.body.sourceDetails);

    if (Object.keys(data).length === 0) return res.status(400).json({ message: "No fields to update" });

    const result = await prisma.supplier.updateMany({
      where: { id, tenantId },
      data,
    });

    if (result.count === 0) return res.status(404).json({ message: "Supplier not found" });

    const updated = await prisma.supplier.findFirst({ where: { id, tenantId } });
    return res.json(updated);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return res.status(400).json({ message: "This ID is already used for another supplier in this store." });
    }
    console.error("updateSupplier error:", err);
    return res.status(500).json({ message: "Failed to update supplier" });
  }
}

// -----------------------
// PATCH activate/deactivate
// -----------------------
async function activateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = String(req.params.id || "");
    const r = await prisma.supplier.updateMany({
      where: { id, tenantId, isActive: false },
      data: { isActive: true },
    });
    if (r.count === 0) return res.status(404).json({ message: "Supplier not found or already active" });
    return res.json({ message: "Supplier activated" });
  } catch (err) {
    console.error("activateSupplier error:", err);
    return res.status(500).json({ message: "Failed to activate supplier" });
  }
}
async function deactivateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = String(req.params.id || "");
    const r = await prisma.supplier.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    if (r.count === 0) return res.status(404).json({ message: "Supplier not found or already inactive" });
    return res.json({ message: "Supplier deactivated" });
  } catch (err) {
    console.error("deactivateSupplier error:", err);
    return res.status(500).json({ message: "Failed to deactivate supplier" });
  }
}

// -----------------------
// GET /api/suppliers/:id/supplies
// -----------------------
async function listSupplies(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const supplierId = String(req.params.id || "");
    const rows = await prisma.supplierSupply.findMany({
      where: { tenantId, supplierId },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        createdAt: true,
        sourceType: true,
        documentRef: true,
        notes: true,
        SupplierSupplyItem: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            buyPrice: true,
            sellPrice: true,
            serial: true,
          },
        },
      },
    });

    // quick totals per supply (helps owners)
    const supplies = rows.map((s) => {
      const items = s.SupplierSupplyItem || [];
      const totalCost = items.reduce((sum, it) => sum + Number(it.buyPrice || 0) * Number(it.quantity || 0), 0);
      const totalSell = items.reduce((sum, it) => sum + Number(it.sellPrice || 0) * Number(it.quantity || 0), 0);
      return { ...s, totalCost, totalSell, itemsCount: items.length };
    });

    return res.json({ supplies, count: supplies.length });
  } catch (err) {
    console.error("listSupplies error:", err);
    return res.status(500).json({ message: "Failed to load supplies" });
  }
}

// -----------------------
// POST /api/suppliers/:id/supplies
// Body: { documentRef?, notes?, sourceType?, sourceDetails?, items: [...] , alsoUpdateStock?: true }
// -----------------------
async function createSupply(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.userId || null;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const supplierId = String(req.params.id || "");
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: "items are required" });

    const alsoUpdateStock = String(req.body.alsoUpdateStock || "true").toLowerCase() !== "false";

    // validate items first
    for (const it of items) {
      const productName = cleanString(it.productName);
      const qty = toInt(it.quantity, NaN);
      const buy = toMoney(it.buyPrice, NaN);
      const sell = toMoney(it.sellPrice, NaN);

      if (!productName) return res.status(400).json({ message: "Each item must have productName" });
      if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ message: "quantity must be > 0" });
      if (!Number.isFinite(buy) || buy < 0) return res.status(400).json({ message: "buyPrice must be 0 or more" });
      if (!Number.isFinite(sell) || sell < 0) return res.status(400).json({ message: "sellPrice must be 0 or more" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({ where: { id: supplierId, tenantId } });
      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const supply = await tx.supplierSupply.create({
        data: {
          tenantId,
          supplierId,
          sourceType: normalizeSupplySourceType(req.body.sourceType),
          sourceDetails: cleanString(req.body.sourceDetails),
          documentRef: cleanString(req.body.documentRef),
          notes: cleanString(req.body.notes),
        },
        select: { id: true, createdAt: true },
      });

      const createdItems = [];
      const updatedProducts = [];

      for (const it of items) {
        const productId = cleanString(it.productId);
        const productName = cleanString(it.productName);
        const qty = toInt(it.quantity);
        const buy = toMoney(it.buyPrice);
        const sell = toMoney(it.sellPrice);

        const row = await tx.supplierSupplyItem.create({
          data: {
            tenantId,
            supplyId: supply.id,
            productId: productId || null,
            productName,
            category: cleanString(it.category),
            subcategory: cleanString(it.subcategory),
            subcategoryOther: cleanString(it.subcategoryOther),
            brand: cleanString(it.brand),
            serial: cleanString(it.serial),
            quantity: qty,
            buyPrice: buy,
            sellPrice: sell,
            notes: cleanString(it.notes),
          },
          select: { id: true },
        });
        createdItems.push(row);

        // optional: update inventory stock (real life)
        if (alsoUpdateStock && productId) {
          const p = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { id: true, stockQty: true },
          });

          if (p) {
            const after = Number(p.stockQty || 0) + qty;
            await tx.product.update({
              where: { id: p.id },
              data: {
                stockQty: after,
                costPrice: buy,
                sellPrice: sell,
                supplierId,
                supplierName: supplier.name,
              },
            });

            // log stock adjustment
            await tx.stockAdjustment.create({
              data: {
                tenantId,
                productId: p.id,
                type: "RESTOCK",
                delta: qty,
                beforeQty: Number(p.stockQty || 0),
                afterQty: after,
                note: `Supplier supply (${supplier.name})`,
                createdById: userId,
              },
              select: { id: true },
            });

            updatedProducts.push(p.id);
          }
        }
      }

      return { supply, createdItemsCount: createdItems.length, updatedProductsCount: updatedProducts.length };
    });

    return res.status(201).json({ created: true, ...result });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg === "SUPPLIER_NOT_FOUND") return res.status(404).json({ message: "Supplier not found" });
    console.error("createSupply error:", err);
    return res.status(500).json({ message: "Failed to create supply" });
  }
}

module.exports = {
  listSuppliers,
  createSupplier,
  getSupplier,
  updateSupplier,
  activateSupplier,
  deactivateSupplier,
  listSupplies,
  createSupply,
};