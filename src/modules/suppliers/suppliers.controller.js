// src/modules/suppliers/suppliers.controller.js
const { Prisma } = require("@prisma/client");
const prisma = require("../../config/database");

function cleanString(value) {
  const s = value == null ? "" : String(value).trim();
  return s || null;
}

function cleanStringStrict(value) {
  return String(value || "").trim();
}

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function toMoney(value, fallback = NaN) {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTenantId(req) {
  return req.user?.tenantId || req.tenantId || null;
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

function getAllowedBranchIds(req) {
  return Array.isArray(req.user?.allowedBranchIds) ? req.user.allowedBranchIds.filter(Boolean) : [];
}

function modelHasField(modelName, fieldName) {
  const model = Prisma.dmmf?.datamodel?.models?.find((item) => item.name === modelName);
  return Boolean(model?.fields?.some((field) => field.name === fieldName));
}

function modelExists(modelName) {
  return Boolean(Prisma.dmmf?.datamodel?.models?.some((item) => item.name === modelName));
}

const HAS_SUPPLIER_SUPPLY_BRANCH = modelHasField("SupplierSupply", "branchId");
const HAS_BRANCH_INVENTORY = modelExists("BranchInventory");
const HAS_STOCK_ADJUSTMENT_BRANCH = modelHasField("StockAdjustment", "branchId");

const ID_TYPES = new Set(["NATIONAL_ID", "PASSPORT"]);
const SUPPLIER_SOURCE_TYPES = new Set(["BOUGHT", "GIFT", "TRADE_IN", "CONSIGNMENT", "OTHER"]);
const SUPPLY_SOURCE_TYPES = new Set(["BOUGHT", "GIFT", "TRADE_IN", "CONSIGNMENT", "OTHER"]);

function normalizeIdType(value) {
  const x = cleanStringStrict(value).toUpperCase();
  return ID_TYPES.has(x) ? x : null;
}

function normalizeSupplierSourceType(value) {
  const x = cleanStringStrict(value).toUpperCase();
  return SUPPLIER_SOURCE_TYPES.has(x) ? x : "OTHER";
}

function normalizeSupplySourceType(value) {
  const x = cleanStringStrict(value).toUpperCase();
  return SUPPLY_SOURCE_TYPES.has(x) ? x : "OTHER";
}

function serializeBranch(branch) {
  if (!branch) return null;

  return {
    id: branch.id,
    name: branch.name || "",
    code: branch.code || "",
    status: branch.status || "",
    isMain: Boolean(branch.isMain),
  };
}

function serializeSupplier(row) {
  if (!row) return null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    idType: row.idType,
    idNumber: row.idNumber,
    phone: row.phone || null,
    email: row.email || null,
    address: row.address || null,
    notes: row.notes || null,
    isActive: Boolean(row.isActive),
    companyName: row.companyName || null,
    taxId: row.taxId || null,
    sourceType: row.sourceType || "OTHER",
    sourceDetails: row.sourceDetails || null,
    verifiedAt: row.verifiedAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function serializeSupply(row) {
  const items = Array.isArray(row?.SupplierSupplyItem) ? row.SupplierSupplyItem : [];

  const totalCost = items.reduce(
    (sum, item) => sum + Number(item.buyPrice || 0) * Number(item.quantity || 0),
    0
  );

  const totalSell = items.reduce(
    (sum, item) => sum + Number(item.sellPrice || 0) * Number(item.quantity || 0),
    0
  );

  return {
    id: row.id,
    tenantId: row.tenantId,
    supplierId: row.supplierId,
    branchId: row.branchId || null,
    branch: serializeBranch(row.branch),
    sourceType: row.sourceType || "OTHER",
    sourceDetails: row.sourceDetails || null,
    documentRef: row.documentRef || null,
    notes: row.notes || null,
    createdAt: row.createdAt || null,
    itemsCount: items.length,
    totalCost,
    totalSell,
    items: items.map((item) => ({
      id: item.id,
      productId: item.productId || null,
      productName: item.productName,
      category: item.category || null,
      subcategory: item.subcategory || null,
      subcategoryOther: item.subcategoryOther || null,
      brand: item.brand || null,
      serial: item.serial || null,
      quantity: Number(item.quantity || 0),
      buyPrice: Number(item.buyPrice || 0),
      sellPrice: Number(item.sellPrice || 0),
      notes: item.notes || null,
    })),
  };
}

function branchScopePayload(scope) {
  return {
    mode: scope?.mode || "SINGLE_BRANCH",
    branchId: scope?.branchId || null,
    canViewAllBranches: Boolean(scope?.canViewAllBranches),
    allowedBranchIds: Array.isArray(scope?.allowedBranchIds) ? scope.allowedBranchIds : [],
  };
}

function throwBranchError(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

function resolveSupplierBranchScope(req) {
  const requestedBranchId =
    cleanString(req.query?.branchId) || cleanString(req.headers["x-branch-id"]) || null;

  const allBranchesRequested =
    cleanStringStrict(req.query?.allBranches).toLowerCase() === "true";

  const allowedBranchIds = getAllowedBranchIds(req);
  const canSeeAll = canViewAllBranches(req);

  if (allBranchesRequested) {
    if (!canSeeAll) throwBranchError("BRANCH_ACCESS_DENIED");

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      canViewAllBranches: true,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (!canSeeAll && !allowedBranchIds.includes(requestedBranchId)) {
      throwBranchError("BRANCH_ACCESS_DENIED");
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      canViewAllBranches: canSeeAll,
      allowedBranchIds,
    };
  }

  const activeBranchId = getActiveBranchId(req);

  if (activeBranchId) {
    if (!canSeeAll && !allowedBranchIds.includes(activeBranchId)) {
      throwBranchError("BRANCH_ACCESS_DENIED");
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: activeBranchId,
      canViewAllBranches: canSeeAll,
      allowedBranchIds,
    };
  }

  if (canSeeAll) {
    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      canViewAllBranches: true,
      allowedBranchIds,
    };
  }

  return {
    mode: "NO_BRANCH",
    branchId: null,
    canViewAllBranches: false,
    allowedBranchIds,
  };
}

function supplyBranchWhere(scope) {
  if (!HAS_SUPPLIER_SUPPLY_BRANCH) return {};

  if (scope?.mode === "ALL_BRANCHES") return {};

  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    return { branchId: scope.branchId };
  }

  return { branchId: "__NO_BRANCH_ACCESS__" };
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    throwBranchError("BRANCH_REQUIRED");
  }

  const allowedBranchIds = getAllowedBranchIds(req);

  if (!canViewAllBranches(req) && !allowedBranchIds.includes(branchId)) {
    throwBranchError("BRANCH_ACCESS_DENIED");
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

  if (!branch) throwBranchError("BRANCH_NOT_FOUND");
  if (branch.status !== "ACTIVE") throwBranchError("BRANCH_NOT_ACTIVE");

  return branch;
}

async function incrementBranchInventoryIfPossible(tx, { tenantId, branchId, productId, quantity }) {
  if (!HAS_BRANCH_INVENTORY || !tx.branchInventory || !branchId || !productId) return null;

  const existing = await tx.branchInventory.findFirst({
    where: {
      tenantId,
      branchId,
      productId,
    },
    select: {
      id: true,
      qtyOnHand: true,
    },
  });

  if (existing) {
    return tx.branchInventory.update({
      where: { id: existing.id },
      data: {
        qtyOnHand: Number(existing.qtyOnHand || 0) + Number(quantity || 0),
      },
    });
  }

  return tx.branchInventory.create({
    data: {
      tenantId,
      branchId,
      productId,
      qtyOnHand: Number(quantity || 0),
    },
  });
}

function handleBranchError(res, err) {
  const code = String(err?.code || err?.message || "");

  if (code === "BRANCH_REQUIRED") {
    return res.status(400).json({
      message: "No active branch selected",
      code: "BRANCH_REQUIRED",
    });
  }

  if (code === "BRANCH_ACCESS_DENIED") {
    return res.status(403).json({
      message: "Branch access denied",
      code: "BRANCH_ACCESS_DENIED",
    });
  }

  if (code === "BRANCH_NOT_FOUND") {
    return res.status(404).json({
      message: "Branch not found",
      code: "BRANCH_NOT_FOUND",
    });
  }

  if (code === "BRANCH_NOT_ACTIVE") {
    return res.status(409).json({
      message: "Selected branch is not active",
      code: "BRANCH_NOT_ACTIVE",
    });
  }

  return null;
}

function isDuplicateError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "").toLowerCase();

  return code === "P2002" || msg.includes("unique") || msg.includes("duplicate");
}

async function listSuppliers(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const q = cleanString(req.query.q);
    const activeRaw = cleanString(req.query.active);
    const active = activeRaw == null ? true : cleanStringStrict(activeRaw).toLowerCase() === "true";

    const where = {
      tenantId,
      isActive: active,
    };

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
        tenantId: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        isActive: true,
        companyName: true,
        taxId: true,
        sourceType: true,
        sourceDetails: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      suppliers: rows.map(serializeSupplier),
      count: rows.length,
    });
  } catch (err) {
    console.error("listSuppliers error:", err);
    return res.status(500).json({ message: "Failed to load suppliers" });
  }
}

async function createSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const name = cleanString(req.body.name);
    const idType = normalizeIdType(req.body.idType);
    const idNumber = cleanString(req.body.idNumber);

    if (!name) return res.status(400).json({ message: "Supplier name is required" });

    if (!idType) {
      return res.status(400).json({ message: "ID type must be National ID or Passport" });
    }

    if (!idNumber) {
      return res.status(400).json({ message: "ID number is required" });
    }

    const created = await prisma.supplier.create({
      data: {
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
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        isActive: true,
        companyName: true,
        taxId: true,
        sourceType: true,
        sourceDetails: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.status(201).json({
      created: true,
      supplier: serializeSupplier(created),
    });
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(400).json({
        message: "This ID is already used for another supplier in this store.",
      });
    }

    console.error("createSupplier error:", err);
    return res.status(500).json({ message: "Failed to create supplier" });
  }
}

async function getSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = cleanStringStrict(req.params.id);

    const supplier = await prisma.supplier.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        isActive: true,
        companyName: true,
        taxId: true,
        sourceType: true,
        sourceDetails: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    return res.json(serializeSupplier(supplier));
  } catch (err) {
    console.error("getSupplier error:", err);
    return res.status(500).json({ message: "Failed to load supplier" });
  }
}

async function updateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = cleanStringStrict(req.params.id);
    const data = {};

    if (req.body.name != null) {
      const name = cleanString(req.body.name);
      if (!name) return res.status(400).json({ message: "Supplier name cannot be empty" });
      data.name = name;
    }

    if (req.body.phone !== undefined) data.phone = cleanString(req.body.phone);
    if (req.body.email !== undefined) data.email = cleanString(req.body.email);
    if (req.body.address !== undefined) data.address = cleanString(req.body.address);
    if (req.body.notes !== undefined) data.notes = cleanString(req.body.notes);
    if (req.body.companyName !== undefined) data.companyName = cleanString(req.body.companyName);
    if (req.body.taxId !== undefined) data.taxId = cleanString(req.body.taxId);

    if (req.body.idType !== undefined) {
      const idType = normalizeIdType(req.body.idType);
      if (!idType) {
        return res.status(400).json({ message: "ID type must be National ID or Passport" });
      }
      data.idType = idType;
    }

    if (req.body.idNumber !== undefined) {
      const idNumber = cleanString(req.body.idNumber);
      if (!idNumber) return res.status(400).json({ message: "ID number cannot be empty" });
      data.idNumber = idNumber;
    }

    if (req.body.sourceType !== undefined) {
      data.sourceType = normalizeSupplierSourceType(req.body.sourceType);
    }

    if (req.body.sourceDetails !== undefined) {
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
      select: {
        id: true,
        tenantId: true,
        name: true,
        idType: true,
        idNumber: true,
        phone: true,
        email: true,
        address: true,
        notes: true,
        isActive: true,
        companyName: true,
        taxId: true,
        sourceType: true,
        sourceDetails: true,
        verifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json(serializeSupplier(updated));
  } catch (err) {
    if (isDuplicateError(err)) {
      return res.status(400).json({
        message: "This ID is already used for another supplier in this store.",
      });
    }

    console.error("updateSupplier error:", err);
    return res.status(500).json({ message: "Failed to update supplier" });
  }
}

async function activateSupplier(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const id = cleanStringStrict(req.params.id);

    const result = await prisma.supplier.updateMany({
      where: { id, tenantId, isActive: false },
      data: { isActive: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Supplier not found or already active" });
    }

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

    const id = cleanStringStrict(req.params.id);

    const result = await prisma.supplier.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Supplier not found or already inactive" });
    }

    return res.json({ message: "Supplier deactivated" });
  } catch (err) {
    console.error("deactivateSupplier error:", err);
    return res.status(500).json({ message: "Failed to deactivate supplier" });
  }
}

async function listSupplies(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const supplierId = cleanStringStrict(req.params.id);
    const scope = resolveSupplierBranchScope(req);

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true },
    });

    if (!supplier) return res.status(404).json({ message: "Supplier not found" });

    const rows = await prisma.supplierSupply.findMany({
      where: {
        tenantId,
        supplierId,
        ...supplyBranchWhere(scope),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        supplierId: true,
        createdAt: true,
        sourceType: true,
        sourceDetails: true,
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
            category: true,
            subcategory: true,
            subcategoryOther: true,
            brand: true,
            serial: true,
            quantity: true,
            buyPrice: true,
            sellPrice: true,
            notes: true,
          },
        },
      },
    });

    const supplies = rows.map(serializeSupply);

    return res.json({
      supplies,
      count: supplies.length,
      branchScope: branchScopePayload(scope),
    });
  } catch (err) {
    const handled = handleBranchError(res, err);
    if (handled) return handled;

    console.error("listSupplies error:", err);
    return res.status(500).json({ message: "Failed to load supplies" });
  }
}

async function createSupply(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const activeBranch = await ensureWritableBranchAccessOrThrow(req);
    const supplierId = cleanStringStrict(req.params.id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!items.length) return res.status(400).json({ message: "At least one supply item is required" });

    const alsoUpdateStock = cleanStringStrict(req.body.alsoUpdateStock || "true").toLowerCase() !== "false";

    for (const item of items) {
      const productName = cleanString(item.productName);
      const quantity = toInt(item.quantity, NaN);
      const buyPrice = toMoney(item.buyPrice, NaN);
      const sellPrice = toMoney(item.sellPrice, NaN);

      if (!productName) return res.status(400).json({ message: "Each item must have product name" });

      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ message: "Each item quantity must be more than 0" });
      }

      if (!Number.isFinite(buyPrice) || buyPrice < 0) {
        return res.status(400).json({ message: "Each item buy price must be 0 or more" });
      }

      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        return res.status(400).json({ message: "Each item sell price must be 0 or more" });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: supplierId, tenantId },
        select: { id: true, name: true },
      });

      if (!supplier) throw new Error("SUPPLIER_NOT_FOUND");

      const supply = await tx.supplierSupply.create({
        data: {
          tenantId,
          supplierId,
          branchId: HAS_SUPPLIER_SUPPLY_BRANCH ? activeBranch.id : undefined,
          sourceType: normalizeSupplySourceType(req.body.sourceType),
          sourceDetails: cleanString(req.body.sourceDetails),
          documentRef: cleanString(req.body.documentRef),
          notes: cleanString(req.body.notes),
        },
        select: {
          id: true,
          tenantId: true,
          branchId: true,
          supplierId: true,
          sourceType: true,
          sourceDetails: true,
          documentRef: true,
          notes: true,
          createdAt: true,
        },
      });

      const createdItems = [];
      const updatedProducts = [];

      for (const item of items) {
        const productId = cleanString(item.productId);
        const productName = cleanString(item.productName);
        const quantity = toInt(item.quantity);
        const buyPrice = toMoney(item.buyPrice);
        const sellPrice = toMoney(item.sellPrice);

        const createdItem = await tx.supplierSupplyItem.create({
          data: {
            tenantId,
            supplyId: supply.id,
            productId: productId || null,
            productName,
            category: cleanString(item.category),
            subcategory: cleanString(item.subcategory),
            subcategoryOther: cleanString(item.subcategoryOther),
            brand: cleanString(item.brand),
            serial: cleanString(item.serial),
            quantity,
            buyPrice,
            sellPrice,
            notes: cleanString(item.notes),
          },
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            buyPrice: true,
            sellPrice: true,
            serial: true,
          },
        });

        createdItems.push(createdItem);

        if (!alsoUpdateStock) continue;

        let product = null;
        let beforeQtyGlobal = 0;
        let afterQtyGlobal = quantity;

        if (productId) {
          product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { id: true, stockQty: true },
          });

          if (!product) continue;

          beforeQtyGlobal = Number(product.stockQty || 0);
          afterQtyGlobal = beforeQtyGlobal + quantity;

          await tx.product.update({
            where: { id: product.id },
            data: {
              stockQty: afterQtyGlobal,
              costPrice: buyPrice,
              sellPrice,
              supplierId,
              supplierName: supplier.name,
              isActive: true,
            },
          });
        } else {
          product = await tx.product.create({
            data: {
              tenantId,
              name: productName,
              category: cleanString(item.category),
              subcategory: cleanString(item.subcategory),
              subcategoryOther: cleanString(item.subcategoryOther),
              brand: cleanString(item.brand),
              serial: cleanString(item.serial),
              costPrice: buyPrice,
              sellPrice,
              stockQty: quantity,
              supplierId,
              supplierName: supplier.name,
              isActive: true,
            },
            select: { id: true, stockQty: true },
          });

          beforeQtyGlobal = 0;
          afterQtyGlobal = Number(product.stockQty || quantity);

          await tx.supplierSupplyItem.update({
            where: { id: createdItem.id },
            data: { productId: product.id },
            select: { id: true },
          });
        }

        await incrementBranchInventoryIfPossible(tx, {
          tenantId,
          branchId: activeBranch.id,
          productId: product.id,
          quantity,
        });

        const stockAdjustmentData = {
          tenantId,
          productId: product.id,
          type: "RESTOCK",
          delta: quantity,
          beforeQty: beforeQtyGlobal,
          afterQty: afterQtyGlobal,
          note: `Supplier supply from ${supplier.name} at ${activeBranch.code || activeBranch.name || "current selling location"}`,
          createdById: userId,
        };

        if (HAS_STOCK_ADJUSTMENT_BRANCH) {
          stockAdjustmentData.branchId = activeBranch.id;
        }

        await tx.stockAdjustment.create({
          data: stockAdjustmentData,
          select: { id: true },
        });

        updatedProducts.push(product.id);
      }

      return {
        branchId: activeBranch.id,
        branchCode: activeBranch.code || null,
        branchName: activeBranch.name || null,
        supply,
        createdItemsCount: createdItems.length,
        updatedProductsCount: updatedProducts.length,
      };
    });

    return res.status(201).json({
      created: true,
      ...result,
    });
  } catch (err) {
    const handled = handleBranchError(res, err);
    if (handled) return handled;

    if (String(err?.message || "") === "SUPPLIER_NOT_FOUND") {
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