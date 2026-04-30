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

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function resolveSupplierBranchScope(req) {
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

async function createOrSetBranchInventoryIfPossible(tx, { tenantId, branchId, productId, qtyOnHand }) {
  if (!branchId || !tx.branchInventory || typeof tx.branchInventory.upsert !== "function") {
    return null;
  }

  const compositeWhere =
    tx.branchInventory.fields &&
    typeof tx.branchInventory.fields.branchId !== "undefined"
      ? {
          tenantId_branchId_productId: {
            tenantId,
            branchId,
            productId,
          },
        }
      : null;

  if (!compositeWhere) {
    const existing = await tx.branchInventory.findFirst({
      where: { tenantId, branchId, productId },
      select: { id: true },
    });

    if (existing) {
      return tx.branchInventory.update({
        where: { id: existing.id },
        data: { qtyOnHand },
      });
    }

    return tx.branchInventory.create({
      data: {
        tenantId,
        branchId,
        productId,
        qtyOnHand,
      },
    });
  }

  return tx.branchInventory.upsert({
    where: compositeWhere,
    update: { qtyOnHand },
    create: {
      tenantId,
      branchId,
      productId,
      qtyOnHand,
    },
  });
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
        verifiedAt: true,
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
    if (!idType) {
      return res.status(400).json({ message: "idType must be NATIONAL_ID or PASSPORT" });
    }
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
      select: {
        id: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        companyName: true,
        sourceType: true,
        verifiedAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ created: true, supplier: created });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return res.status(400).json({
        message: "This ID is already used for another supplier in this store.",
      });
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
      if (!t) {
        return res.status(400).json({ message: "idType must be NATIONAL_ID or PASSPORT" });
      }
      data.idType = t;
    }

    if (req.body.idNumber != null) {
      const n = cleanString(req.body.idNumber);
      if (!n) return res.status(400).json({ message: "idNumber cannot be empty" });
      data.idNumber = n;
    }

    if (req.body.sourceType != null) {
      data.sourceType = normalizeSupplierSourceType(req.body.sourceType);
    }

    if (req.body.sourceDetails != null) {
      data.sourceDetails = cleanString(req.body.sourceDetails);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    const result = await prisma.supplier.updateMany({
      where: { id, tenantId },
      data,
    });

    if (result.count === 0) return res.status(404).json({ message: "Supplier not found" });

    const updated = await prisma.supplier.findFirst({
      where: { id, tenantId },
    });

    return res.json(updated);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return res.status(400).json({
        message: "This ID is already used for another supplier in this store.",
      });
    }

    console.error("updateSupplier error:", err);
    return res.status(500).json({ message: "Failed to update supplier" });
  }
}

// -----------------------
// PATCH /api/suppliers/:id/activate
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

    if (r.count === 0) {
      return res.status(404).json({ message: "Supplier not found or already active" });
    }

    return res.json({ message: "Supplier activated" });
  } catch (err) {
    console.error("activateSupplier error:", err);
    return res.status(500).json({ message: "Failed to activate supplier" });
  }
}

// -----------------------
// PATCH /api/suppliers/:id/deactivate
// -----------------------
async function deactivateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = String(req.params.id || "");
    const r = await prisma.supplier.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });

    if (r.count === 0) {
      return res.status(404).json({ message: "Supplier not found or already inactive" });
    }

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

    const scope = resolveSupplierBranchScope(req);
    const supplierId = String(req.params.id || "");
    const rows = await prisma.supplierSupply.findMany({
      where: {
        tenantId,
        supplierId,
        ...(scope.mode === "SINGLE_BRANCH" && scope.branchId ? { branchId: scope.branchId } : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        branchId: true,
        createdAt: true,
        sourceType: true,
        documentRef: true,
        notes: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
        SupplierSupplyItem: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            buyPrice: true,
            sellPrice: true,
            serial: true,
          },
        },
      },
    });

    const supplies = rows.map((s) => {
      const items = s.SupplierSupplyItem || [];
      const totalCost = items.reduce(
        (sum, it) => sum + Number(it.buyPrice || 0) * Number(it.quantity || 0),
        0
      );
      const totalSell = items.reduce(
        (sum, it) => sum + Number(it.sellPrice || 0) * Number(it.quantity || 0),
        0
      );

      return {
        ...s,
        totalCost,
        totalSell,
        itemsCount: items.length,
      };
    });

    return res.json({ supplies, count: supplies.length, branchScope: scope });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listSupplies error:", err);
    return res.status(500).json({ message: "Failed to load supplies" });
  }
}

// -----------------------
// POST /api/suppliers/:id/supplies
// -----------------------
async function createSupply(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = req.user?.userId || req.user?.id || null;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const activeBranch = await ensureWritableBranchAccessOrThrow(req);
    const supplierId = String(req.params.id || "");
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ message: "items are required" });

    const alsoUpdateStock = String(req.body.alsoUpdateStock || "true").toLowerCase() !== "false";

    for (const it of items) {
      const productName = cleanString(it.productName);
      const qty = toInt(it.quantity, NaN);
      const buy = toMoney(it.buyPrice, NaN);
      const sell = toMoney(it.sellPrice, NaN);

      if (!productName) {
        return res.status(400).json({ message: "Each item must have productName" });
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ message: "quantity must be > 0" });
      }
      if (!Number.isFinite(buy) || buy < 0) {
        return res.status(400).json({ message: "buyPrice must be 0 or more" });
      }
      if (!Number.isFinite(sell) || sell < 0) {
        return res.status(400).json({ message: "sellPrice must be 0 or more" });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true, name: true },
      });

      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const supplyCreateData = {
        tenantId,
        supplierId,
        sourceType: normalizeSupplySourceType(req.body.sourceType),
        sourceDetails: cleanString(req.body.sourceDetails),
        documentRef: cleanString(req.body.documentRef),
        notes: cleanString(req.body.notes),
      };

      if (typeof tx.supplierSupply.fields?.branchId !== "undefined") {
        supplyCreateData.branchId = activeBranch.id;
      }

      const supply = await tx.supplierSupply.create({
        data: supplyCreateData,
        select: {
          id: true,
          createdAt: true,
          ...(typeof tx.supplierSupply.fields?.branchId !== "undefined" ? { branchId: true } : {}),
        },
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

        if (alsoUpdateStock && productId) {
          const p = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { id: true, stockQty: true },
          });

          if (p) {
            const beforeQtyGlobal = Number(p.stockQty || 0);
            const afterQtyGlobal = beforeQtyGlobal + qty;

            await tx.product.update({
              where: { id: p.id },
              data: {
                stockQty: afterQtyGlobal,
                costPrice: buy,
                sellPrice: sell,
                supplierId,
                supplierName: supplier.name,
              },
            });

            if (tx.branchInventory && typeof tx.branchInventory.findFirst === "function") {
              const existingBranchInventory = await tx.branchInventory.findFirst({
                where: {
                  tenantId,
                  branchId: activeBranch.id,
                  productId: p.id,
                },
                select: {
                  id: true,
                  qtyOnHand: true,
                },
              });

              if (existingBranchInventory) {
                await tx.branchInventory.update({
                  where: { id: existingBranchInventory.id },
                  data: {
                    qtyOnHand: Number(existingBranchInventory.qtyOnHand || 0) + qty,
                  },
                });
              } else {
                await createOrSetBranchInventoryIfPossible(tx, {
                  tenantId,
                  branchId: activeBranch.id,
                  productId: p.id,
                  qtyOnHand: qty,
                });
              }
            }

            const stockAdjustmentData = {
              tenantId,
              productId: p.id,
              type: "RESTOCK",
              delta: qty,
              beforeQty: beforeQtyGlobal,
              afterQty: afterQtyGlobal,
              note: `Supplier supply (${supplier.name}) • Branch ${activeBranch.code || activeBranch.id}`,
              createdById: userId,
            };

            if (typeof tx.stockAdjustment.fields?.branchId !== "undefined") {
              stockAdjustmentData.branchId = activeBranch.id;
            }

            await tx.stockAdjustment.create({
              data: stockAdjustmentData,
              select: { id: true },
            });

            updatedProducts.push(p.id);
          }
        }
      }

      return {
        branchId: activeBranch.id,
        branchCode: activeBranch.code,
        supply,
        createdItemsCount: createdItems.length,
        updatedProductsCount: updatedProducts.length,
      };
    });

    return res.status(201).json({ created: true, ...result });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

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
    if (msg === "SUPPLIER_NOT_FOUND") {
      return res.status(404).json({ message: "Supplier not found" });
    }

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