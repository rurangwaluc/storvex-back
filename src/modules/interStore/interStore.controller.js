const {
  PrismaClient,
  InterStoreDealStatus,
  AuditAction,
  InterStorePaymentMethod,
} = require("@prisma/client");

const prisma = new PrismaClient();

const logAudit = require("../../utils/auditLogger");

// Strict enum allowlists (prevents random strings)
const ALLOWED_INTERSTORE_METHODS = new Set(
  Object.values(InterStorePaymentMethod) // CASH, MOMO, BANK, OTHER
);

function normalizeInterStoreMethod(method) {
  if (method == null) return "CASH";
  if (typeof method !== "string" && typeof method !== "number") return null;

  const m = String(method).trim().toUpperCase();
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

function assertBorrower(deal, tenantId) {
  return deal.borrowerTenantId === tenantId;
}

function assertCanView(deal, tenantId) {
  return deal.borrowerTenantId === tenantId || deal.supplierTenantId === tenantId;
}

/**
 * CREATE DEAL (BORROW)
 * - Requires reseller identity + product identity.
 * - If internal supplier + productId: decrement supplier stock immediately (physical item left).
 * - Enforces serial required (DB-level + API-level).
 * - Enforces quantity rules for serialized items (Phase 1).
 */
async function createDeal(req, res) {
  try {
    const borrowerTenantId = req.user.tenantId;

    const {
      supplierTenantId,
      externalSupplierName,
      externalSupplierPhone,

      // Person who took the item
      resellerName,
      resellerPhone,
      resellerStore,
      resellerWorkplace,
      resellerDistrict,
      resellerSector,
      resellerAddress,
      resellerNationalId,

      // Product
      productId,
      productName,
      productCategory,
      productColor,
      serial,
      quantity,

      // Money + timing
      agreedPrice,
      dueDate,
      takenAt,
      notes,
    } = req.body;

    // ---- Required validations ----
    if (!resellerName || !resellerPhone) {
      return res
        .status(400)
        .json({ message: "resellerName and resellerPhone are required" });
    }

    if (!productName) {
      return res.status(400).json({ message: "productName is required" });
    }

    // serial REQUIRED
    if (!serial || String(serial).trim().length === 0) {
      return res.status(400).json({ message: "serial is required" });
    }

    if (agreedPrice == null) {
      return res.status(400).json({ message: "agreedPrice is required" });
    }

    // Supplier validation
    if (!supplierTenantId && !externalSupplierName) {
      return res
        .status(400)
        .json({ message: "Supplier required (internal or external)" });
    }

    if (supplierTenantId && externalSupplierName) {
      return res
        .status(400)
        .json({ message: "Choose one supplier type only" });
    }

    if (supplierTenantId && supplierTenantId === borrowerTenantId) {
      return res
        .status(400)
        .json({ message: "Supplier cannot be the same tenant as borrower" });
    }

    // Price validation
    const price = toNum(agreedPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return res
        .status(400)
        .json({ message: "agreedPrice must be a positive number" });
    }

    // Quantity validation
    const qty = quantity == null ? 1 : toInt(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res
        .status(400)
        .json({ message: "quantity must be a positive integer" });
    }

    // Phase 1 serialized rule
    if (qty !== 1) {
      return res.status(400).json({
        message:
          "For serialized electronics, quantity must be 1 per deal. Next step: support quantity > 1 using serials[] list.",
      });
    }

    // Parse dueDate / takenAt safely
    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    if (dueDate && Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ message: "dueDate is invalid ISO date" });
    }

    // ✅ NEW: dueDate cannot be in the past (prevents broken real-world collections)
    if (parsedDueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (parsedDueDate < today) {
        return res
          .status(400)
          .json({ message: "dueDate cannot be in the past" });
      }

      // optional cap: 365 days
      const max = new Date(today);
      max.setDate(max.getDate() + 365);
      if (parsedDueDate > max) {
        return res
          .status(400)
          .json({ message: "dueDate too far in the future" });
      }
    }

    const parsedTakenAt = takenAt ? new Date(takenAt) : null;
    if (takenAt && Number.isNaN(parsedTakenAt.getTime())) {
      return res.status(400).json({ message: "takenAt is invalid ISO date" });
    }

    const deal = await prisma.$transaction(async (tx) => {
      // If internal supplier + productId, validate and decrement supplier stock by qty
      if (supplierTenantId && productId) {
        const supplierProduct = await tx.product.findFirst({
          where: { id: productId, tenantId: supplierTenantId, isActive: true },
          select: { id: true, stockQty: true, name: true },
        });

        if (!supplierProduct) throw new Error("SUPPLIER_PRODUCT_NOT_FOUND");
        if (supplierProduct.stockQty < qty) throw new Error("SUPPLIER_OUT_OF_STOCK");

        await tx.product.update({
          where: { id: supplierProduct.id },
          data: { stockQty: { decrement: qty } },
        });
      }

      return tx.interStoreDeal.create({
        data: {
          borrowerTenantId,

          supplierTenantId: supplierTenantId || null,
          externalSupplierName: externalSupplierName || null,
          externalSupplierPhone: externalSupplierPhone || null,

          // reseller identity
          resellerName: String(resellerName).trim(),
          resellerPhone: String(resellerPhone).trim(),
          resellerStore: resellerStore ? String(resellerStore).trim() : null,
          resellerWorkplace: resellerWorkplace ? String(resellerWorkplace).trim() : null,
          resellerDistrict: resellerDistrict ? String(resellerDistrict).trim() : null,
          resellerSector: resellerSector ? String(resellerSector).trim() : null,
          resellerAddress: resellerAddress ? String(resellerAddress).trim() : null,
          resellerNationalId: resellerNationalId ? String(resellerNationalId).trim() : null,

          // product info
          productId: productId || null,
          productName: String(productName).trim(),
          productCategory: productCategory ? String(productCategory).trim() : null,
          productColor: productColor ? String(productColor).trim() : null,
          serial: String(serial).trim(),

          // quantities
          quantity: qty,
          soldQuantity: 0,
          returnedQuantity: 0,

          // money + timing
          agreedPrice: price,
          dueDate: parsedDueDate,
          takenAt: parsedTakenAt,

          notes: notes ? String(notes) : null,

          status: InterStoreDealStatus.BORROWED,
          borrowedAt: new Date(),
        },
      });
    });

    await logAudit({
      tenantId: borrowerTenantId,
      userId: req.user.userId,
      action: AuditAction.CREATE_DEAL, // ✅ enum-safe
      entity: "InterStoreDeal",
      entityId: deal.id,
      metadata: {
        supplierTenantId: supplierTenantId || null,
        externalSupplierName: externalSupplierName || null,
        productId: productId || null,
        productName: deal.productName,
        serial: deal.serial,
        quantity: deal.quantity,
        agreedPrice: deal.agreedPrice,
        resellerPhone: deal.resellerPhone,
        dueDate: deal.dueDate || null,
      },
    });


    return res.status(201).json(deal);
  } catch (err) {
    if (err.message === "SUPPLIER_PRODUCT_NOT_FOUND") {
      return res.status(404).json({ message: "Supplier product not found" });
    }
    if (err.message === "SUPPLIER_OUT_OF_STOCK") {
      return res.status(400).json({ message: "Supplier product out of stock" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to create deal" });
  }
}

/**
 * MARK RECEIVED
 * - borrower only
 * - only allowed when status = BORROWED
 * - idempotent
 * - creates borrower inventory product exactly once
 * - stockQty = quantity
 */
async function markReceived(req, res) {
  try {
    const id = req.params.id;
    const tenantId = req.user.tenantId;

    const deal = await prisma.interStoreDeal.findUnique({ where: { id } });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (!assertBorrower(deal, tenantId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (deal.status === InterStoreDealStatus.RECEIVED && deal.receivedProductId) {
      return res.json(deal);
    }

    if (deal.status !== InterStoreDealStatus.BORROWED) {
      return res.status(400).json({ message: `Cannot mark received in status ${deal.status}` });
    }

    const result = await prisma.$transaction(async (tx) => {
      let receivedProductId = deal.receivedProductId || null;

      if (!receivedProductId) {
        const createdProduct = await tx.product.create({
          data: {
            tenantId: deal.borrowerTenantId,
            name: deal.productName,
            serial: deal.serial, // ✅ required now
            costPrice: deal.agreedPrice,
            sellPrice: deal.agreedPrice, // borrower can edit later
            stockQty: deal.quantity,
            isActive: true,
          },
          select: { id: true },
        });

        receivedProductId = createdProduct.id;
      }

      return tx.interStoreDeal.update({
        where: { id },
        data: {
          status: InterStoreDealStatus.RECEIVED,
          receivedAt: new Date(),
          receivedProductId,
        },
      });
    });

    await logAudit({
      tenantId,
      userId: req.user.userId,
      action: AuditAction.MARK_RECEIVED,
      entity: "InterStoreDeal",
      entityId: result.id,
      metadata: { receivedProductId: result.receivedProductId, quantity: result.quantity },
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to mark received" });
  }
}

/**
 * MARK SOLD
 * - borrower only
 * - requires RECEIVED + receivedProductId
 * - decrements borrower stock by soldQuantity
 * - updates soldQuantity and sets SOLD only if fully resolved (sold+returned == quantity)
 */
async function markSold(req, res) {
  try {
    const id = req.params.id;
    const tenantId = req.user.tenantId;

    const { soldPrice, soldQuantity } = req.body;

    const sp = soldPrice == null ? null : toNum(soldPrice);
    if (soldPrice != null && (!Number.isFinite(sp) || sp <= 0)) {
      return res.status(400).json({ message: "soldPrice must be a positive number" });
    }

    const sq = soldQuantity == null ? 1 : toInt(soldQuantity);
    if (!Number.isFinite(sq) || sq <= 0) {
      return res.status(400).json({ message: "soldQuantity must be a positive integer" });
    }

    const deal = await prisma.interStoreDeal.findUnique({ where: { id } });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (!assertBorrower(deal, tenantId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

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
      // decrement borrower product stock
      await tx.product.update({
        where: { id: deal.receivedProductId },
        data: { stockQty: { decrement: sq } },
      });

      const newSoldQty = deal.soldQuantity + sq;
      const fullyResolved = newSoldQty + deal.returnedQuantity === deal.quantity;

      // If fully resolved by sales -> SOLD
      const next = await tx.interStoreDeal.update({
        where: { id },
        data: {
          soldQuantity: newSoldQty,
          soldAt: fullyResolved ? new Date() : deal.soldAt,
          soldPrice: sp ?? deal.soldPrice,
          status: fullyResolved ? InterStoreDealStatus.SOLD : InterStoreDealStatus.RECEIVED,
        },
      });

      // deactivate if stock is now <= 0
      const p = await tx.product.findUnique({
        where: { id: deal.receivedProductId },
        select: { stockQty: true },
      });

      if (p && p.stockQty <= 0) {
        await tx.product.update({
          where: { id: deal.receivedProductId },
          data: { isActive: false },
        });
      }

      return next;
    });

    await logAudit({
      tenantId,
      userId: req.user.userId,
      action: AuditAction.MARK_SOLD,
      entity: "InterStoreDeal",
      entityId: updated.id,
      metadata: { soldQuantity: sq, totalSoldQuantity: updated.soldQuantity, soldPrice: sp },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to mark sold" });
  }
}

/**
 * MARK RETURNED
 * - borrower only
 * - allowed if BORROWED or RECEIVED
 * - decrements borrower inventory (if receivedProductId exists) by returnedQuantity
 * - increments supplier stock by returnedQuantity if internal supplier + productId
 * - status RETURNED only when fully resolved (sold+returned == quantity) and nothing sold? (we keep RETURNED anyway as resolution)
 */
async function markReturned(req, res) {
  try {
    const id = req.params.id;
    const tenantId = req.user.tenantId;

    const { returnedQuantity } = req.body;
    const rq = returnedQuantity == null ? 1 : toInt(returnedQuantity);

    if (!Number.isFinite(rq) || rq <= 0) {
      return res.status(400).json({ message: "returnedQuantity must be a positive integer" });
    }

    const deal = await prisma.interStoreDeal.findUnique({ where: { id } });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (!assertBorrower(deal, tenantId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (![InterStoreDealStatus.BORROWED, InterStoreDealStatus.RECEIVED].includes(deal.status)) {
      return res.status(400).json({ message: `Cannot return in status ${deal.status}` });
    }

    const remaining = deal.quantity - deal.soldQuantity - deal.returnedQuantity;
    if (rq > remaining) {
      return res.status(400).json({ message: `Cannot return ${rq}. Remaining is ${remaining}.` });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // If borrower already received inventory, decrement stock by returned quantity
      if (deal.receivedProductId) {
        await tx.product.update({
          where: { id: deal.receivedProductId },
          data: { stockQty: { decrement: rq } },
        });

        const p = await tx.product.findUnique({
          where: { id: deal.receivedProductId },
          select: { stockQty: true },
        });

        if (p && p.stockQty <= 0) {
          await tx.product.update({
            where: { id: deal.receivedProductId },
            data: { isActive: false },
          });
        }
      }

      // Return to internal supplier stock
      if (deal.supplierTenantId && deal.productId) {
        await tx.product.update({
          where: { id: deal.productId },
          data: { stockQty: { increment: rq } },
        });
      }

      const newReturnedQty = deal.returnedQuantity + rq;
      const fullyResolved = deal.soldQuantity + newReturnedQty === deal.quantity;

      const nextStatus = fullyResolved ? InterStoreDealStatus.RETURNED : deal.status;

      return tx.interStoreDeal.update({
        where: { id },
        data: {
          returnedQuantity: newReturnedQty,
          returnedAt: fullyResolved ? new Date() : deal.returnedAt,
          status: nextStatus,
        },
      });
    });

    await logAudit({
      tenantId,
      userId: req.user.userId,
      action: AuditAction.MARK_RETURNED,
      entity: "InterStoreDeal",
      entityId: updated.id,
      metadata: { returnedQuantity: rq, totalReturnedQuantity: updated.returnedQuantity },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to mark returned" });
  }
}

/**
 * MARK PAID
 * - borrower only (route restricts OWNER)
 * - requires SOLD
 * - stores paidAmount + paymentMethod (optional)
 */
async function markPaid(req, res) {
  try {
    const id = req.params.id;
    const tenantId = req.user.tenantId;

    const { paidAmount, paymentMethod } = req.body;

    const amt = paidAmount == null ? null : toNum(paidAmount);
    if (amt == null || !Number.isFinite(amt) || amt <= 0) {
      return res
        .status(400)
        .json({ message: "paidAmount must be a positive number" });
    }

    const deal = await prisma.interStoreDeal.findUnique({ where: { id } });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    if (!assertBorrower(deal, tenantId)) {
      return res.status(403).json({ message: "Not authorized" });
    }

    if (deal.status !== InterStoreDealStatus.SOLD) {
      return res
        .status(400)
        .json({ message: `Cannot mark paid in status ${deal.status}` });
    }

    // ✅ PAID means fully paid supplier
    // owed = agreedPrice * soldQuantity (soldQuantity must be > 0 once SOLD)
    const soldQty = Number(deal.soldQuantity || 0);
    const owed = Number(deal.agreedPrice) * soldQty;

    if (!Number.isFinite(owed) || owed <= 0) {
      return res.status(400).json({
        message: "Invalid owed amount (check agreedPrice and soldQuantity)",
        owed,
        soldQuantity: deal.soldQuantity,
        agreedPrice: deal.agreedPrice,
      });
    }

    if (amt < owed) {
      return res.status(400).json({
        message: "Cannot mark PAID. paidAmount is less than amount owed to supplier.",
        owed,
        paidAmount: amt,
      });
    }

    const updated = await prisma.interStoreDeal.update({
      where: { id },
      data: {
        status: InterStoreDealStatus.PAID,
        paidAt: new Date(),
        paidAmount: amt,
        paymentMethod: paymentMethod ? String(paymentMethod).toUpperCase() : null,
      },
    });

    await logAudit({
      tenantId,
      userId: req.user.userId,
      action: AuditAction.MARK_PAID,
      entity: "InterStoreDeal",
      entityId: updated.id,
      metadata: { paidAmount: amt, paymentMethod: updated.paymentMethod, owed },
    });

    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to mark paid" });
  }
}

/**
 * LIST DEALS
 * borrower OR internal supplier can view
 */
async function listDeals(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const deals = await prisma.interStoreDeal.findMany({
      where: {
        OR: [{ borrowerTenantId: tenantId }, { supplierTenantId: tenantId }],
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(deals);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch deals" });
  }
}
async function listOutstanding(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const deals = await prisma.interStoreDeal.findMany({
      where: {
        borrowerTenantId: tenantId,
        status: "SOLD",
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        productName: true,
        serial: true,
        quantity: true,
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
      },
    });

    // derived fields for UI
    const now = Date.now();
    const items = deals.map((d) => {
      const due = d.dueDate ? new Date(d.dueDate).getTime() : null;
      const daysLeft = due == null ? null : Math.ceil((due - now) / (1000 * 60 * 60 * 24));
      return { ...d, daysLeft };
    });

    return res.json({ deals: items, count: items.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch outstanding deals" });
  }
}

async function listOverdue(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const now = new Date();

    const deals = await prisma.interStoreDeal.findMany({
      where: {
        borrowerTenantId: tenantId,
        status: "SOLD",
        dueDate: { not: null, lt: now },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        status: true,
        productName: true,
        serial: true,
        quantity: true,
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
      },
    });

    const nowMs = Date.now();
    const items = deals.map((d) => {
      const dueMs = d.dueDate ? new Date(d.dueDate).getTime() : null;
      const daysOverdue = dueMs == null ? null : Math.ceil((nowMs - dueMs) / (1000 * 60 * 60 * 24));
      return { ...d, daysOverdue };
    });

    return res.json({ deals: items, count: items.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch overdue deals" });
  }
}

async function searchDeals(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const qRaw = req.query.q;

    if (!qRaw || String(qRaw).trim().length < 2) {
      return res.status(400).json({ message: "Query 'q' is required (min 2 chars)" });
    }

    const q = String(qRaw).trim();

    const deals = await prisma.interStoreDeal.findMany({
      where: {
        borrowerTenantId: tenantId,
        OR: [
          { serial: { contains: q, mode: "insensitive" } },
          { resellerPhone: { contains: q, mode: "insensitive" } },
          { resellerName: { contains: q, mode: "insensitive" } },
          { productName: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.json({ deals, count: deals.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to search deals" });
  }
}

async function searchCollections(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const qRaw = req.query.q;
    const scope = (req.query.scope || "all").toLowerCase(); // all | outstanding | overdue

    const q = qRaw ? String(qRaw).trim() : "";

    const baseWhere = { borrowerTenantId: tenantId };

    let where = baseWhere;

    if (scope === "outstanding") {
      where = { ...baseWhere, status: "SOLD" };
    } else if (scope === "overdue") {
      where = { ...baseWhere, status: "SOLD", dueDate: { not: null, lt: new Date() } };
    }

    const deals = await prisma.interStoreDeal.findMany({
      where: q.length >= 2
        ? {
            ...where,
            OR: [
              { serial: { contains: q, mode: "insensitive" } },
              { resellerPhone: { contains: q, mode: "insensitive" } },
              { resellerName: { contains: q, mode: "insensitive" } },
              { productName: { contains: q, mode: "insensitive" } }
            ],
          }
        : where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 100,
    });

    return res.json({ deals, count: deals.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to search collections" });
  }
}


// ----------------------------------------------------
// ✅ ADD PAYMENT (Installments) — mismatch-proof version
// Key fixes vs your current version:
// 1) Always scope payments by (dealId + borrowerTenantId) to prevent cross-tenant mismatch
// 2) Always write InterStorePayment.tenantId = deal.borrowerTenantId (source of truth)
// 3) Always sum with tenantId filter
// 4) Keep SOLD-only policy (simple + safe). PAID blocks new payments.
// ----------------------------------------------------
async function addPayment(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const id = req.params.id;

    const { amount, method, note } = req.body;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    // Normalize + validate method against Prisma enum
    const m = normalizeInterStoreMethod(method);
    if (!m) {
      return res
        .status(400)
        .json({ message: "method must be one of CASH, MOMO, BANK, OTHER" });
    }

    const deal = await prisma.interStoreDeal.findUnique({ where: { id } });
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // borrower only can record supplier payments
    if (deal.borrowerTenantId !== tenantId) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // ✅ Policy: installments only after SOLD
    if (deal.status === InterStoreDealStatus.PAID) {
      return res.status(400).json({ message: "Deal already fully paid" });
    }

    if (deal.status !== InterStoreDealStatus.SOLD) {
      return res.status(400).json({
        message: `Cannot add payment in status ${deal.status}. Sell first (status must be SOLD).`,
      });
    }

    // owed = agreedPrice * soldQuantity
    const owedRaw = Number(deal.agreedPrice) * Number(deal.soldQuantity || 0);
    const owed = Number.isFinite(owedRaw) ? owedRaw : 0;

    if (owed <= 0) {
      return res.status(400).json({
        message: "Invalid owed amount (check agreedPrice and soldQuantity)",
        owed,
        soldQuantity: deal.soldQuantity,
        agreedPrice: deal.agreedPrice,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // ✅ Recompute current total (scoped to borrower tenant) BEFORE insert
      const aggBefore = await tx.interStorePayment.aggregate({
        where: {
          dealId: deal.id,
          tenantId: deal.borrowerTenantId, // ✅ prevents mismatch
        },
        _sum: { amount: true },
      });

      const totalPaidBefore = Number(aggBefore._sum.amount || 0);

      // ✅ Prevent overpay (race-safe within transaction)
      if (totalPaidBefore + amt > owed) {
        return {
          overpay: true,
          owed,
          totalPaidBefore,
        };
      }

      // ✅ Force payment tenantId to borrower tenant (source of truth)
      const payment = await tx.interStorePayment.create({
        data: {
          dealId: deal.id,
          tenantId: deal.borrowerTenantId, // ✅ prevents mismatch
          receivedById: userId,
          amount: amt,
          method: m, // ✅ Prisma enum
          note: note ? String(note) : null,
        },
      });

      // ✅ Recompute total after insert (still scoped)
      const aggAfter = await tx.interStorePayment.aggregate({
        where: {
          dealId: deal.id,
          tenantId: deal.borrowerTenantId, // ✅ prevents mismatch
        },
        _sum: { amount: true },
      });

      const totalPaidAfter = Number(aggAfter._sum.amount || 0);

      const nextStatus =
        totalPaidAfter >= owed ? InterStoreDealStatus.PAID : InterStoreDealStatus.SOLD;

      const updatedDeal = await tx.interStoreDeal.update({
        where: { id: deal.id },
        data: {
          paidAmount: totalPaidAfter,
          paymentMethod: m, // field is String? in schema, ok
          paidAt: nextStatus === InterStoreDealStatus.PAID ? new Date() : deal.paidAt,
          status: nextStatus,
        },
      });

      return {
        overpay: false,
        payment,
        updatedDeal,
        totalPaid: totalPaidAfter,
        owed,
      };
    });

    // If transaction returned overpay info (no DB changes)
    if (result && result.overpay) {
      return res.status(400).json({
        message: "Payment exceeds amount owed",
        owed: result.owed,
        totalPaid: result.totalPaidBefore,
        attemptedPayment: amt,
        balanceDue: Math.max(0, result.owed - result.totalPaidBefore),
      });
    }

    // ✅ Audit log (enum-safe)
    await logAudit({
      tenantId: deal.borrowerTenantId, // ✅ audit under borrower tenant
      userId,
      action: AuditAction.ADD_PAYMENT,
      entity: "InterStoreDeal",
      entityId: deal.id,
      metadata: {
        dealId: deal.id,
        paymentId: result.payment.id,
        amount: amt,
        method: m,
        note: note ? String(note) : null,
        totalPaid: result.totalPaid,
        owed: result.owed,
        statusAfter: result.updatedDeal.status,
      },
    });

    return res.json({
      message: "Installment recorded",
      payment: result.payment,
      deal: {
        id: result.updatedDeal.id,
        status: result.updatedDeal.status,
        agreedPrice: result.updatedDeal.agreedPrice,
        soldQuantity: result.updatedDeal.soldQuantity,
        owed: result.owed,
        paidAmount: result.totalPaid,
        balanceDue: Math.max(0, result.owed - result.totalPaid),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to add payment" });
  }
}

/**
 * GET /api/interstore/audit
 */
async function listDealAudit(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const logs = await prisma.auditLog.findMany({
      where: { tenantId, entity: "InterStoreDeal" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json({ logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch audit logs" });
  }
}
// ----------------------------------------------------
// ✅ GET DEAL PAYMENTS — borrower OR supplier can view (safe + scoped)
// ----------------------------------------------------
async function getDealPayments(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const id = req.params.id;

    const deal = await prisma.interStoreDeal.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        borrowerTenantId: true,
        supplierTenantId: true,
        agreedPrice: true,
        soldQuantity: true,
      },
    });

    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // ✅ Viewer rule (same as your version)
    const canView =
      deal.borrowerTenantId === tenantId ||
      (deal.supplierTenantId && deal.supplierTenantId === tenantId);

    if (!canView) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // ✅ CRITICAL: payments always belong to the BORROWER tenant
    // (because addPayment is borrower-only and writes tenantId = borrowerTenantId)
    const payments = await prisma.interStorePayment.findMany({
      where: {
        dealId: deal.id,
        tenantId: deal.borrowerTenantId, // ✅ prevents poisoned totals
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        amount: true,
        method: true,
        note: true,
        createdAt: true,
        receivedById: true,
      },
    });

    const totalPaid = payments.reduce((sum, p) => {
      const n = Number(p.amount);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    // ✅ Owed matches addPayment logic: owed = agreedPrice * soldQuantity
    // (only meaningful when SOLD/PAID)
    const soldQty = Number(deal.soldQuantity || 0);
    const price = Number(deal.agreedPrice);

    const owedBase =
      Number.isFinite(price) && Number.isFinite(soldQty) ? price * soldQty : 0;

    const owed =
      deal.status === InterStoreDealStatus.SOLD ||
      deal.status === InterStoreDealStatus.PAID
        ? owedBase
        : 0;

    return res.json({
      dealId: deal.id,
      status: deal.status,
      agreedPrice: deal.agreedPrice,
      soldQuantity: deal.soldQuantity,
      owed,
      totalPaid,
      balanceDue: Math.max(0, owed - totalPaid),
      payments,
      count: payments.length,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch deal payments" });
  }
}

module.exports = {
  createDeal,
  markReceived,
  markSold,
  markReturned,
  markPaid,
  listDeals,
  listDealAudit,
  listOutstanding,
  listOverdue,
  searchDeals,
  searchCollections,
  addPayment,
  getDealPayments
};
