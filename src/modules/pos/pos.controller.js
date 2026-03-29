"use strict";

const prisma = require("../../config/database");
const {
  reserveSaleDocumentNumbersTx,
  reserveWarrantyDocumentNumberTx,
} = require("../documents/documentNumber.service");

// -----------------------------
// helpers
// -----------------------------
function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  const s = String(value || "").trim();
  return s || null;
}

function toNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - Number(n || 0));
  return d;
}

function normalizeSaleType(value) {
  const v = String(value || "CASH").toUpperCase();
  return v === "CREDIT" ? "CREDIT" : "CASH";
}

function normalizePaymentMethod(value) {
  const v = String(value || "CASH").toUpperCase();
  if (v === "CASH" || v === "MOMO" || v === "BANK" || v === "OTHER") return v;
  return "CASH";
}

function normalizeRefundMethod(value) {
  const v = String(value || "CASH").toUpperCase();
  if (v === "CASH" || v === "MOMO" || v === "BANK" || v === "OTHER") return v;
  return "CASH";
}

function computeSaleStatus({ saleType, total, amountPaid, dueDate }) {
  const t = Number(total) || 0;
  const paid = Number(amountPaid) || 0;
  const balanceDue = Math.max(0, t - paid);

  if (saleType === "CASH") {
    return { status: "PAID", balanceDue: 0 };
  }

  const hasDue = dueDate && !Number.isNaN(new Date(dueDate).getTime());
  const isOverdue = hasDue && new Date(dueDate) < new Date();

  if (balanceDue <= 0) return { status: "PAID", balanceDue: 0 };
  if (paid > 0) return { status: isOverdue ? "OVERDUE" : "PARTIAL", balanceDue };

  return { status: isOverdue ? "OVERDUE" : "UNPAID", balanceDue };
}

function addMonthsUtc(date, months) {
  const d = new Date(date);
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + Number(months || 0),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );
}

function addDaysUtc(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

function computeWarrantyEndDate(startsAt, durationMonths, durationDays) {
  let end = new Date(startsAt);
  if (Number(durationMonths || 0) > 0) {
    end = addMonthsUtc(end, Number(durationMonths || 0));
  }
  if (Number(durationDays || 0) > 0) {
    end = addDaysUtc(end, Number(durationDays || 0));
  }
  return end;
}

const SUPPORTED_AUDIT_ACTIONS = new Set([
  "CREATE_DEAL",
  "MARK_SOLD",
  "MARK_RETURNED",
  "MARK_PAID",
  "MARK_RECEIVED",
  "ADD_PAYMENT",
  "EXPENSE_CREATED",
  "EXPENSE_APPROVED",
  "EXPENSE_DELETED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DEACTIVATED",
  "PRODUCT_ACTIVATED",
]);

const SUPPORTED_AUDIT_ENTITIES = new Set([
  "INTERSTORE_DEAL",
  "EXPENSE",
  "SALE",
  "REPAIR",
  "PRODUCT",
  "CUSTOMER",
  "USER",
  "TENANT",
  "SUBSCRIPTION",
  "PAYMENT",
]);

async function writeAuditLog(db, { tenantId, userId, entity, action, entityId, metadata }) {
  try {
    if (!SUPPORTED_AUDIT_ACTIONS.has(String(action || ""))) {
      console.warn("writeAuditLog skipped: unsupported AuditAction", action);
      return;
    }

    if (!SUPPORTED_AUDIT_ENTITIES.has(String(entity || ""))) {
      console.warn("writeAuditLog skipped: unsupported AuditEntity", entity);
      return;
    }

    await db.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
        entity,
        action,
        entityId: entityId || null,
        metadata: metadata || null,
      },
    });
  } catch (err) {
    console.error("writeAuditLog error:", err);
  }
}

function saleDraftWhereFalse() {
  return typeof prisma.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {};
}

// -----------------------------
// customer resolution
// Supports:
// - customerId
// - customer: { name, phone, email, address, tinNumber, idNumber, notes }
// -----------------------------
async function resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer }) {
  if (customerId) {
    const existing = await tx.customer.findFirst({
      where: {
        id: String(customerId),
        tenantId,
        ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
      },
      select: { id: true },
    });

    if (!existing) {
      throw new Error("CUSTOMER_NOT_FOUND");
    }

    return existing.id;
  }

  if (!customer) return null;

  const cleanName = normalizeText(customer.name);
  const cleanPhone = normalizePhone(customer.phone);
  const cleanEmail = normalizeText(customer.email);
  const cleanAddress = normalizeText(customer.address);
  const cleanTinNumber = normalizeText(customer.tinNumber);
  const cleanIdNumber = normalizeText(customer.idNumber);
  const cleanNotes = normalizeText(customer.notes);

  if (!cleanName || !cleanPhone) {
    throw new Error("INVALID_CUSTOMER_FIELDS");
  }

  const existing = await tx.customer.findFirst({
    where: {
      tenantId,
      phone: cleanPhone,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      ...(typeof tx.customer.fields?.email !== "undefined" ? { email: true } : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" ? { address: true } : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
    },
  });

  if (existing) {
    const updateData = {
      ...(cleanName && cleanName !== existing.name ? { name: cleanName } : {}),
      ...(typeof tx.customer.fields?.email !== "undefined" && cleanEmail !== existing.email
        ? { email: cleanEmail }
        : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" && cleanAddress !== existing.address
        ? { address: cleanAddress }
        : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined" &&
      cleanTinNumber !== existing.tinNumber
        ? { tinNumber: cleanTinNumber }
        : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" &&
      cleanIdNumber !== existing.idNumber
        ? { idNumber: cleanIdNumber }
        : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" && cleanNotes !== existing.notes
        ? { notes: cleanNotes }
        : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" && existing.isActive === false
        ? { isActive: true }
        : {}),
    };

    if (Object.keys(updateData).length > 0) {
      await tx.customer.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    return existing.id;
  }

  const created = await tx.customer.create({
    data: {
      tenantId,
      name: cleanName,
      phone: cleanPhone,
      ...(typeof tx.customer.fields?.email !== "undefined" ? { email: cleanEmail } : {}),
      ...(typeof tx.customer.fields?.address !== "undefined" ? { address: cleanAddress } : {}),
      ...(typeof tx.customer.fields?.tinNumber !== "undefined"
        ? { tinNumber: cleanTinNumber }
        : {}),
      ...(typeof tx.customer.fields?.idNumber !== "undefined" ? { idNumber: cleanIdNumber } : {}),
      ...(typeof tx.customer.fields?.notes !== "undefined" ? { notes: cleanNotes } : {}),
      ...(typeof tx.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
    },
    select: { id: true },
  });

  return created.id;
}

async function resolveCustomerId(tx, tenantId, payload) {
  const { customerId, customer, customerName, customerPhone } = payload || {};

  if (customerId || customer) {
    return resolveOrCreateCustomerTx(tx, tenantId, { customerId, customer });
  }

  if (customerName || customerPhone) {
    return resolveOrCreateCustomerTx(tx, tenantId, {
      customer: {
        name: customerName,
        phone: customerPhone,
      },
    });
  }

  return null;
}

async function getOpenCashSessionId(tx, tenantId) {
  const rows = await tx.$queryRaw`
    select id
    from public.cash_sessions
    where tenant_id = ${String(tenantId)}::uuid
      and closed_at is null
    order by opened_at desc
    limit 1
  `;
  return rows?.[0]?.id || null;
}

async function insertCashMovementIfPossible(
  tx,
  { tenantId, userId, sessionId, type, reason, amount, note }
) {
  const amountBigInt = BigInt(Math.round(Number(amount || 0)));
  if (!sessionId) return null;

  const rows = await tx.$queryRaw`
    insert into public.cash_movements
      (tenant_id, session_id, type, reason, amount, note, created_by)
    values
      (
        ${String(tenantId)}::uuid,
        ${String(sessionId)}::uuid,
        ${String(type)}::cash_movement_type,
        ${String(reason)}::cash_movement_reason,
        ${amountBigInt},
        ${note},
        ${String(userId)}::uuid
      )
    returning id, type, reason, amount, note, created_at, created_by
  `;

  return rows?.[0] || null;
}

async function getTenantCashDrawerPolicy(tenantId) {
  const rows = await prisma.$queryRaw`
    select cash_drawer_block_cash_sales
    from public."Tenant"
    where id = ${String(tenantId)}::text
    limit 1
  `;

  const blockCashSales = rows?.[0]?.cash_drawer_block_cash_sales;
  return blockCashSales == null ? true : Boolean(blockCashSales);
}

// -----------------------------
// GET /api/pos/quick-picks
// -----------------------------
async function quickPicks(req, res) {
  try {
    const { tenantId } = req.user;

    const periodDaysRaw = toInt(req.query.periodDays, 7);
    const limitRaw = toInt(req.query.limit, 10);

    const periodDays =
      Number.isFinite(periodDaysRaw) && periodDaysRaw > 0 && periodDaysRaw <= 90
        ? periodDaysRaw
        : 7;

    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 10;

    const since = daysAgo(periodDays);

    const grouped = await prisma.saleItem.groupBy({
      by: ["productId"],
      where: {
        sale: {
          tenantId,
          createdAt: { gte: since },
          isCancelled: false,
          ...saleDraftWhereFalse(),
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });

    const productIds = grouped.map((g) => g.productId);
    let bestSellers = [];

    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: {
          tenantId,
          isActive: true,
          id: { in: productIds },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          serial: true,
          sellPrice: true,
          stockQty: true,
        },
      });

      const byId = new Map(products.map((p) => [p.id, p]));

      bestSellers = grouped
        .map((g) => {
          const p = byId.get(g.productId);
          if (!p) return null;
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            serial: p.serial,
            sellPrice: p.sellPrice,
            stockQty: p.stockQty,
            soldQty: Number(g._sum.quantity || 0),
          };
        })
        .filter(Boolean);
    }

    const latest = await prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        sku: true,
        serial: true,
        sellPrice: true,
        stockQty: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return res.json({
      periodDays,
      limit,
      bestSellers,
      latest,
    });
  } catch (err) {
    console.error("quickPicks error:", err);
    return res.status(500).json({ message: "Failed to load quick picks" });
  }
}

// -----------------------------
// POST /api/pos/sales
// -----------------------------
async function createSale(req, res) {
  try {
    const { tenantId, userId } = req.user;

    const {
      items,
      customerId,
      customer,
      customerName,
      customerPhone,
      saleType,
      amountPaid,
      dueDate,
      paymentMethod,
    } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Sale items are required" });
    }

    for (const item of items) {
      if (!item?.productId) {
        return res.status(400).json({ message: "Each item must have productId" });
      }
      const q = toInt(item.quantity, NaN);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ message: "quantity must be a positive integer" });
      }
    }

    const finalSaleType = normalizeSaleType(saleType);
    const initialPaymentMethod = normalizePaymentMethod(paymentMethod || "CASH");

    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    if (dueDate && Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ message: "Invalid dueDate" });
    }

    if (finalSaleType === "CREDIT" && !parsedDueDate) {
      return res.status(400).json({ message: "dueDate is required for credit sale" });
    }

    const paidRequested = Math.max(0, toNumber(amountPaid, 0));

    if (finalSaleType === "CASH") {
      const shouldBlock = await getTenantCashDrawerPolicy(tenantId);
      if (shouldBlock) {
        const openSessionId = await getOpenCashSessionId(prisma, tenantId);
        if (!openSessionId) {
          return res.status(409).json({
            message: "Cash drawer is closed. Open drawer to make CASH sales.",
            code: "CASH_DRAWER_CLOSED",
          });
        }
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const resolvedCustomerId = await resolveCustomerId(tx, tenantId, {
          customerId,
          customer,
          customerName,
          customerPhone,
        });

        const productIds = items.map((i) => String(i.productId));
        const products = await tx.product.findMany({
          where: { tenantId, id: { in: productIds }, isActive: true },
          select: { id: true, name: true, sellPrice: true, stockQty: true },
        });

        const byId = new Map(products.map((p) => [p.id, p]));

        for (const item of items) {
          const pid = String(item.productId);
          if (!byId.has(pid)) throw new Error(`PRODUCT_NOT_FOUND:${pid}`);
        }

        for (const item of items) {
          const pid = String(item.productId);
          const qty = toInt(item.quantity);

          const updated = await tx.product.updateMany({
            where: { id: pid, tenantId, isActive: true, stockQty: { gte: qty } },
            data: { stockQty: { decrement: qty } },
          });

          if (!updated || updated.count !== 1) {
            const p = byId.get(pid);
            throw new Error(`INSUFFICIENT_STOCK:${p?.name || pid}`);
          }
        }

        let total = 0;
        const itemRows = [];

        for (const item of items) {
          const pid = String(item.productId);
          const qty = toInt(item.quantity);
          const p = byId.get(pid);
          const price = Number(p.sellPrice || 0);

          total += price * qty;
          itemRows.push({
            productId: pid,
            quantity: qty,
            price,
          });
        }

        const initialPaid = finalSaleType === "CASH" ? total : Math.min(paidRequested, total);

        if (finalSaleType === "CREDIT" && initialPaid > total + 0.000001) {
          throw new Error("AMOUNT_PAID_TOO_HIGH");
        }

        const { status, balanceDue } = computeSaleStatus({
          saleType: finalSaleType,
          total,
          amountPaid: initialPaid,
          dueDate: parsedDueDate,
        });

        const saleCreatedAt = new Date();
        const documentNumbers = await reserveSaleDocumentNumbersTx(tx, {
          tenantId,
          createdAt: saleCreatedAt,
        });

        const sale = await tx.sale.create({
          data: {
            tenantId,
            cashierId: userId,
            customerId: resolvedCustomerId,
            total,
            saleType: finalSaleType,
            amountPaid: initialPaid,
            balanceDue,
            status,
            dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
            receiptNumber: documentNumbers.receiptNumber,
            invoiceNumber: documentNumbers.invoiceNumber,
            createdAt: saleCreatedAt,
            ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {}),
          },
          select: {
            id: true,
            tenantId: true,
            cashierId: true,
            customerId: true,
            total: true,
            saleType: true,
            status: true,
            amountPaid: true,
            balanceDue: true,
            dueDate: true,
            createdAt: true,
            receiptNumber: true,
            invoiceNumber: true,
            ...(typeof tx.sale.fields?.isDraft !== "undefined" ? { isDraft: true } : {}),
          },
        });

        const createdItems = [];
        for (const row of itemRows) {
          const it = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: row.productId,
              quantity: row.quantity,
              price: row.price,
            },
            select: { id: true, saleId: true, productId: true, quantity: true, price: true },
          });
          createdItems.push(it);
        }

        const openSessionId = await getOpenCashSessionId(tx, tenantId);

        let cashMovement = null;
        let payment = null;
        let depositMovement = null;

        if (finalSaleType === "CASH") {
          cashMovement = await insertCashMovementIfPossible(tx, {
            tenantId,
            userId,
            sessionId: openSessionId,
            type: "IN",
            reason: "OTHER",
            amount: total,
            note: `Cash sale ${sale.id}`,
          });
        }

        if (finalSaleType === "CREDIT" && initialPaid > 0) {
          payment = await tx.salePayment.create({
            data: {
              saleId: sale.id,
              tenantId,
              receivedById: userId,
              amount: initialPaid,
              method: initialPaymentMethod,
              note: `Initial payment ${sale.id} ${Date.now()}`,
            },
            select: { id: true, amount: true, method: true, createdAt: true, note: true },
          });

          if (initialPaymentMethod === "CASH") {
            depositMovement = await insertCashMovementIfPossible(tx, {
              tenantId,
              userId,
              sessionId: openSessionId,
              type: "IN",
              reason: "DEPOSIT",
              amount: initialPaid,
              note: `Credit deposit ${sale.id}`,
            });
          }
        }

        return {
          sale,
          items: createdItems,
          payment,
          cashMovement,
          depositMovement,
          auditMeta: {
            saleType: finalSaleType,
            total,
            amountPaid: initialPaid,
            balanceDue,
            itemCount: createdItems.length,
            receiptNumber: sale.receiptNumber,
            invoiceNumber: sale.invoiceNumber,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: result.sale.id,
      metadata: {
        event: "SALE_CREATED",
        ...result.auditMeta,
      },
    });

    return res.status(201).json({
      created: true,
      sale: result.sale,
      items: result.items,
      payment: result.payment,
      cashMovement: result.cashMovement
        ? {
            id: result.cashMovement.id,
            type: result.cashMovement.type,
            reason: result.cashMovement.reason,
            amount: String(result.cashMovement.amount),
            note: result.cashMovement.note,
            createdAt: result.cashMovement.created_at,
            createdBy: result.cashMovement.created_by,
          }
        : null,
      depositMovement: result.depositMovement
        ? {
            id: result.depositMovement.id,
            type: result.depositMovement.type,
            reason: result.depositMovement.reason,
            amount: String(result.depositMovement.amount),
            note: result.depositMovement.note,
            createdAt: result.depositMovement.created_at,
            createdBy: result.depositMovement.created_by,
          }
        : null,
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (msg === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({
        message: "customer.name and customer.phone are required when creating a customer from sale",
      });
    }
    if (msg === "CUSTOMER_NOT_FOUND") {
      return res.status(404).json({ message: "Customer not found" });
    }
    if (msg.startsWith("PRODUCT_NOT_FOUND:")) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (msg.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(400).json({
        message: msg.replace("INSUFFICIENT_STOCK:", "Insufficient stock for "),
      });
    }
    if (msg === "AMOUNT_PAID_TOO_HIGH") {
      return res.status(400).json({ message: "amountPaid cannot exceed total" });
    }

    console.error("createSale error:", err);
    return res.status(500).json({ message: "Failed to create sale" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/warranty
// -----------------------------
async function createSaleWarranty(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const saleId = String(req.params.id || "").trim();

    const { policy, durationMonths, durationDays, startsAt, units } = req.body || {};

    if (!saleId) {
      return res.status(400).json({ message: "Missing sale id" });
    }

    if (!Array.isArray(units) || units.length === 0) {
      return res.status(400).json({ message: "Warranty units are required" });
    }

    const parsedDurationMonths = Math.max(0, toInt(durationMonths, 0));
    const parsedDurationDays = Math.max(0, toInt(durationDays, 0));

    if (parsedDurationMonths === 0 && parsedDurationDays === 0) {
      return res.status(400).json({
        message: "durationMonths or durationDays must be greater than zero",
      });
    }

    const parsedStartsAt = startsAt ? new Date(startsAt) : new Date();
    if (Number.isNaN(parsedStartsAt.getTime())) {
      return res.status(400).json({ message: "Invalid startsAt" });
    }

    for (const unit of units) {
      if (!unit?.saleItemId) {
        return res.status(400).json({ message: "Each warranty unit must have saleItemId" });
      }
      if (!unit?.productId) {
        return res.status(400).json({ message: "Each warranty unit must have productId" });
      }
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, tenantId, ...saleDraftWhereFalse() },
          select: {
            id: true,
            tenantId: true,
            createdAt: true,
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                product: {
                  select: {
                    name: true,
                    sku: true,
                    barcode: true,
                  },
                },
              },
            },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        const saleItemsById = new Map(sale.items.map((it) => [String(it.id), it]));

        for (const unit of units) {
          const saleItemId = String(unit.saleItemId);
          const productId = String(unit.productId);
          const saleItem = saleItemsById.get(saleItemId);

          if (!saleItem) {
            const e = new Error(`SALE_ITEM_NOT_FOUND:${saleItemId}`);
            e.code = "SALE_ITEM_NOT_FOUND";
            throw e;
          }

          if (String(saleItem.productId) !== productId) {
            const e = new Error(`SALE_ITEM_PRODUCT_MISMATCH:${saleItemId}`);
            e.code = "SALE_ITEM_PRODUCT_MISMATCH";
            throw e;
          }
        }

        const endsAt = computeWarrantyEndDate(
          parsedStartsAt,
          parsedDurationMonths,
          parsedDurationDays
        );

        const doc = await reserveWarrantyDocumentNumberTx(tx, {
          tenantId,
          createdAt: parsedStartsAt,
        });

        const warranty = await tx.saleWarranty.create({
          data: {
            saleId: sale.id,
            tenantId,
            createdById: userId,
            policy: normalizeText(policy),
            durationMonths: parsedDurationMonths || null,
            durationDays: parsedDurationDays || null,
            startsAt: parsedStartsAt,
            endsAt,
            warrantyNumber: doc.warrantyNumber,
          },
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            policy: true,
            durationMonths: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            warrantyNumber: true,
          },
        });

        const createdUnits = [];
        for (const unit of units) {
          const saleItem = saleItemsById.get(String(unit.saleItemId));

          const createdUnit = await tx.saleWarrantyUnit.create({
            data: {
              warrantyId: warranty.id,
              saleItemId: String(unit.saleItemId),
              productId: String(unit.productId),
              serial: normalizeText(unit.serial),
              imei1: normalizeText(unit.imei1),
              imei2: normalizeText(unit.imei2),
              unitLabel: normalizeText(unit.unitLabel),
              startsAt: parsedStartsAt,
              endsAt,
            },
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
              createdAt: true,
            },
          });

          createdUnits.push({
            ...createdUnit,
            productName: saleItem?.product?.name || null,
            sku: saleItem?.product?.sku || null,
            barcode: saleItem?.product?.barcode || null,
          });
        }

        return {
          warranty: {
            ...warranty,
            units: createdUnits,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "WARRANTY_CREATED",
        warrantyId: result.warranty.id,
        warrantyNumber: result.warranty.warrantyNumber,
        unitsCount: result.warranty.units.length,
      },
    });

    return res.status(201).json({
      message: "Warranty created",
      warranty: result.warranty,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (msg.startsWith("SALE_ITEM_NOT_FOUND:")) {
      return res.status(400).json({ message: "A sale item was not found for this sale" });
    }

    if (msg.startsWith("SALE_ITEM_PRODUCT_MISMATCH:")) {
      return res.status(400).json({ message: "saleItemId and productId do not match" });
    }

    console.error("createSaleWarranty error:", err);
    return res.status(500).json({ message: "Failed to create warranty" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/payments
// -----------------------------
async function addSalePayment(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const saleId = String(req.params.id || "");
    const { amount, method, note } = req.body || {};

    const payAmount = toNumber(amount, NaN);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const payMethod = normalizePaymentMethod(method);

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, tenantId, ...saleDraftWhereFalse() },
          select: {
            id: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            dueDate: true,
            saleType: true,
            isCancelled: true,
          },
        });

        if (!sale) throw new Error("SALE_NOT_FOUND");
        if (sale.isCancelled) throw new Error("SALE_CANCELLED");
        if (sale.saleType !== "CREDIT") throw new Error("NOT_CREDIT_SALE");

        const newPaid = Number(sale.amountPaid) + payAmount;
        if (newPaid > Number(sale.total) + 0.000001) throw new Error("PAYMENT_TOO_BIG");

        const { status, balanceDue } = computeSaleStatus({
          saleType: "CREDIT",
          total: sale.total,
          amountPaid: newPaid,
          dueDate: sale.dueDate,
        });

        const base = String(note || "").trim();
        const safeNote = base
          ? `${base} • ${sale.id} • ${Date.now()}`
          : `Payment • ${sale.id} • ${Date.now()}`;

        const payment = await tx.salePayment.create({
          data: {
            saleId: sale.id,
            tenantId,
            receivedById: userId,
            amount: payAmount,
            method: payMethod,
            note: safeNote,
          },
          select: { id: true, amount: true, method: true, createdAt: true, note: true },
        });

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            amountPaid: newPaid,
            balanceDue,
            status,
          },
          select: {
            id: true,
            total: true,
            amountPaid: true,
            balanceDue: true,
            status: true,
            dueDate: true,
          },
        });

        let movement = null;

        if (payMethod === "CASH") {
          const openSessionId = await getOpenCashSessionId(tx, tenantId);
          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            userId,
            sessionId: openSessionId,
            type: "IN",
            reason: "DEPOSIT",
            amount: payAmount,
            note: `Credit payment for sale ${sale.id}`,
          });
        }

        return {
          payment,
          sale: updatedSale,
          movement,
          auditMeta: {
            amount: payAmount,
            method: payMethod,
            note: safeNote,
            balanceDueBefore: Number(sale.balanceDue || 0),
            balanceDueAfter: Number(updatedSale.balanceDue || 0),
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: result.auditMeta,
    });

    return res.status(201).json({
      message: "Payment recorded",
      sale: result.sale,
      payment: result.payment,
      cashMovement: result.movement
        ? {
            id: result.movement.id,
            type: result.movement.type,
            reason: result.movement.reason,
            amount: String(result.movement.amount),
            note: result.movement.note,
            createdAt: result.movement.created_at,
            createdBy: result.movement.created_by,
          }
        : null,
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }
    if (msg === "SALE_CANCELLED") {
      return res.status(400).json({ message: "Cannot add payment to cancelled sale" });
    }
    if (msg === "NOT_CREDIT_SALE") {
      return res.status(400).json({ message: "Payments can only be added to CREDIT sales" });
    }
    if (msg === "PAYMENT_TOO_BIG") {
      return res.status(400).json({ message: "Payment exceeds remaining balance" });
    }

    console.error("addSalePayment error:", err);
    return res.status(500).json({ message: "Failed to record payment" });
  }
}

// -----------------------------
// GET /api/pos/sales
// -----------------------------
async function listSales(req, res) {
  try {
    const { tenantId } = req.user;

    const sales = await prisma.sale.findMany({
      where: { tenantId, ...saleDraftWhereFalse() },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        total: true,
        saleType: true,
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        isCancelled: true,
        cancelledAt: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        ...(typeof prisma.sale.fields?.isDraft !== "undefined" ? { isDraft: true } : {}),
        cashier: { select: { name: true } },
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
          },
        },
      },
    });

    return res.json({ sales });
  } catch (err) {
    console.error("listSales error:", err);
    return res.status(500).json({ message: "Failed to fetch sales" });
  }
}

// -----------------------------
// GET /api/pos/sales/:id
// GET /api/pos/sales/:id/receipt
// -----------------------------
async function getSaleReceipt(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const saleId = String(req.params.id || "").trim();

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!saleId) {
      return res.status(400).json({ message: "Missing sale id" });
    }

    const sale = await prisma.sale.findFirst({
      where: {
        id: saleId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        cashierId: true,
        customerId: true,

        total: true,
        createdAt: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        saleType: true,
        status: true,

        isDraft: true,
        draftSource: true,
        finalizedAt: true,

        isCancelled: true,
        cancelledAt: true,
        cancelledById: true,
        cancelNote: true,

        refundedTotal: true,
        receiptNumber: true,
        invoiceNumber: true,

        cashier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
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
          orderBy: [{ id: "asc" }],
          select: {
            id: true,
            saleId: true,
            productId: true,
            quantity: true,
            price: true,
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                ...(typeof prisma.product.fields?.serial !== "undefined" ? { serial: true } : {}),
              },
            },
          },
        },

        payments: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            receivedById: true,
            amount: true,
            method: true,
            note: true,
            createdAt: true,
          },
        },

        refunds: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            createdById: true,
            total: true,
            method: true,
            note: true,
            reason: true,
            createdAt: true,
          },
        },

        warranties: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            saleId: true,
            tenantId: true,
            createdById: true,
            policy: true,
            durationMonths: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            warrantyNumber: true,
            units: {
              orderBy: [{ createdAt: "asc" }],
              select: {
                id: true,
                warrantyId: true,
                saleItemId: true,
                productId: true,
                serial: true,
                imei1: true,
                imei2: true,
                unitLabel: true,
                startsAt: true,
                endsAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    return res.json({ sale });
  } catch (err) {
    console.error("getSaleReceipt error:", err);
    return res.status(500).json({ message: "Failed to load sale" });
  }
}

// -----------------------------
// GET /api/pos/credit/outstanding
// -----------------------------
async function listOutstandingCredit(req, res) {
  try {
    const { tenantId } = req.user;

    const sales = await prisma.sale.findMany({
      where: {
        tenantId,
        saleType: "CREDIT",
        balanceDue: { gt: 0 },
        isCancelled: false,
        ...saleDraftWhereFalse(),
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
          },
        },
      },
    });

    return res.json({ sales });
  } catch (err) {
    console.error("listOutstandingCredit error:", err);
    return res.status(500).json({ message: "Failed to fetch outstanding credit" });
  }
}

// -----------------------------
// GET /api/pos/credit/overdue
// -----------------------------
async function listOverdueCredit(req, res) {
  try {
    const { tenantId } = req.user;

    const now = new Date();
    const sales = await prisma.sale.findMany({
      where: {
        tenantId,
        saleType: "CREDIT",
        balanceDue: { gt: 0 },
        dueDate: { lt: now },
        isCancelled: false,
        ...saleDraftWhereFalse(),
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
            ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
            ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
              ? { tinNumber: true }
              : {}),
            ...(typeof prisma.customer.fields?.idNumber !== "undefined"
              ? { idNumber: true }
              : {}),
          },
        },
      },
    });

    return res.json({ sales });
  } catch (err) {
    console.error("listOverdueCredit error:", err);
    return res.status(500).json({ message: "Failed to fetch overdue credit" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/cancel
// -----------------------------
async function cancelSale(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const saleId = String(req.params.id || "").trim();
    const { note } = req.body || {};

    if (!saleId) return res.status(400).json({ message: "Missing sale id" });

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, tenantId, ...saleDraftWhereFalse() },
          select: {
            id: true,
            tenantId: true,
            saleType: true,
            total: true,
            amountPaid: true,
            isCancelled: true,
            refundedTotal: true,
            items: {
              select: {
                productId: true,
                quantity: true,
              },
            },
            refunds: { select: { id: true }, take: 1 },
            payments: { select: { id: true }, take: 1 },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        if (sale.isCancelled) {
          const e = new Error("ALREADY_CANCELLED");
          e.code = "ALREADY_CANCELLED";
          throw e;
        }

        if ((sale.refunds?.length || 0) > 0 || Number(sale.refundedTotal || 0) > 0) {
          const e = new Error("HAS_REFUNDS");
          e.code = "HAS_REFUNDS";
          throw e;
        }

        if (sale.saleType === "CREDIT") {
          const paid = Number(sale.amountPaid || 0);
          if (paid > 0 || (sale.payments?.length || 0) > 0) {
            const e = new Error("CREDIT_HAS_PAYMENTS");
            e.code = "CREDIT_HAS_PAYMENTS";
            throw e;
          }
        }

        for (const it of sale.items) {
          const updated = await tx.product.updateMany({
            where: { id: it.productId, tenantId, isActive: true },
            data: { stockQty: { increment: it.quantity } },
          });

          if (!updated || updated.count !== 1) {
            const e = new Error(`PRODUCT_NOT_FOUND:${it.productId}`);
            e.code = "PRODUCT_NOT_FOUND";
            throw e;
          }
        }

        const cleanNote = normalizeText(note);

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            isCancelled: true,
            cancelledAt: new Date(),
            cancelledById: userId,
            cancelNote: cleanNote,
          },
          select: {
            id: true,
            saleType: true,
            total: true,
            isCancelled: true,
            cancelledAt: true,
            cancelledById: true,
            cancelNote: true,
          },
        });

        let movement = null;
        if (sale.saleType === "CASH") {
          const openSessionId = await getOpenCashSessionId(tx, tenantId);
          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            userId,
            sessionId: openSessionId,
            type: "OUT",
            reason: "WITHDRAWAL",
            amount: sale.total,
            note: `Cancel sale ${sale.id}`,
          });
        }

        return {
          sale: updatedSale,
          movement,
          auditMeta: {
            note: cleanNote,
            saleType: sale.saleType,
            total: Number(sale.total || 0),
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "SALE_CANCELLED",
        ...result.auditMeta,
      },
    });

    return res.json({
      message: "Sale cancelled",
      sale: result.sale,
      cashMovement: result.movement
        ? {
            id: result.movement.id,
            type: result.movement.type,
            reason: result.movement.reason,
            amount: String(result.movement.amount),
            note: result.movement.note,
            createdAt: result.movement.created_at,
            createdBy: result.movement.created_by,
          }
        : null,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (code === "ALREADY_CANCELLED" || msg === "ALREADY_CANCELLED") {
      return res.status(400).json({ message: "Sale already cancelled" });
    }

    if (code === "HAS_REFUNDS" || msg === "HAS_REFUNDS") {
      return res.status(400).json({ message: "Cannot cancel a sale that has refunds" });
    }

    if (code === "CREDIT_HAS_PAYMENTS" || msg === "CREDIT_HAS_PAYMENTS") {
      return res.status(400).json({ message: "Cannot cancel CREDIT sale that has payments" });
    }

    if (msg.startsWith("PRODUCT_NOT_FOUND:")) {
      return res.status(400).json({ message: "A product on this sale no longer exists" });
    }

    console.error("cancelSale error:", err);
    return res.status(500).json({ message: "Failed to cancel sale" });
  }
}

// -----------------------------
// POST /api/pos/sales/:id/refunds
// -----------------------------
async function createSaleRefund(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const saleId = String(req.params.id || "").trim();
    const { items, method, note, reason } = req.body || {};

    if (!saleId) return res.status(400).json({ message: "Missing sale id" });

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Refund items are required" });
    }

    for (const it of items) {
      if (!it?.productId) {
        return res.status(400).json({ message: "Each refund item must have productId" });
      }
      const q = Number(it.quantity);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ message: "quantity must be a positive integer" });
      }
    }

    const refundMethod = normalizeRefundMethod(method);
    const cleanReason = normalizeText(reason);
    const cleanNote = normalizeText(note);

    const result = await prisma.$transaction(
      async (tx) => {
        const sale = await tx.sale.findFirst({
          where: { id: saleId, tenantId, ...saleDraftWhereFalse() },
          select: {
            id: true,
            tenantId: true,
            saleType: true,
            total: true,
            amountPaid: true,
            refundedTotal: true,
            isCancelled: true,
            items: {
              select: { productId: true, quantity: true, price: true },
            },
            refunds: {
              select: {
                id: true,
                items: { select: { productId: true, quantity: true } },
              },
            },
          },
        });

        if (!sale) {
          const e = new Error("SALE_NOT_FOUND");
          e.code = "SALE_NOT_FOUND";
          throw e;
        }

        if (sale.isCancelled) {
          const e = new Error("SALE_CANCELLED");
          e.code = "SALE_CANCELLED";
          throw e;
        }

        const soldQty = new Map();
        const priceByProduct = new Map();

        for (const it of sale.items) {
          const pid = String(it.productId);
          soldQty.set(pid, (soldQty.get(pid) || 0) + Number(it.quantity || 0));
          priceByProduct.set(pid, Number(it.price || 0));
        }

        const refundedQty = new Map();
        for (const r of sale.refunds || []) {
          for (const it of r.items || []) {
            const pid = String(it.productId);
            refundedQty.set(pid, (refundedQty.get(pid) || 0) + Number(it.quantity || 0));
          }
        }

        for (const reqIt of items) {
          const pid = String(reqIt.productId);
          const q = Number(reqIt.quantity);
          const sold = soldQty.get(pid) || 0;
          const already = refundedQty.get(pid) || 0;
          const remaining = sold - already;

          if (sold <= 0) {
            const e = new Error(`NOT_IN_SALE:${pid}`);
            e.code = "NOT_IN_SALE";
            throw e;
          }
          if (q > remaining) {
            const e = new Error(`REFUND_TOO_MUCH:${pid}`);
            e.code = "REFUND_TOO_MUCH";
            throw e;
          }
        }

        let refundTotal = 0;
        const refundItemRows = [];

        for (const reqIt of items) {
          const pid = String(reqIt.productId);
          const q = Number(reqIt.quantity);
          const price = Number(priceByProduct.get(pid) || 0);

          refundTotal += price * q;
          refundItemRows.push({ productId: pid, quantity: q, price });
        }

        const paidSoFar = Number(sale.amountPaid || 0);
        const refundedSoFar = Number(sale.refundedTotal || 0);
        const refundableMoney = Math.max(0, paidSoFar - refundedSoFar);

        if (refundTotal > refundableMoney + 0.000001) {
          const e = new Error("REFUND_EXCEEDS_PAID");
          e.code = "REFUND_EXCEEDS_PAID";
          throw e;
        }

        const refund = await tx.saleRefund.create({
          data: {
            saleId: sale.id,
            tenantId,
            createdById: userId,
            total: refundTotal,
            method: refundMethod,
            note: cleanNote,
            reason: cleanReason,
          },
          select: {
            id: true,
            total: true,
            method: true,
            note: true,
            reason: true,
            createdAt: true,
          },
        });

        for (const row of refundItemRows) {
          await tx.saleRefundItem.create({
            data: {
              refundId: refund.id,
              productId: row.productId,
              quantity: row.quantity,
              price: row.price,
            },
            select: { id: true },
          });

          await tx.product.updateMany({
            where: { id: row.productId, tenantId, isActive: true },
            data: { stockQty: { increment: row.quantity } },
          });
        }

        const updatedSale = await tx.sale.update({
          where: { id: sale.id },
          data: {
            refundedTotal: { increment: refundTotal },
          },
          select: {
            id: true,
            total: true,
            amountPaid: true,
            refundedTotal: true,
            balanceDue: true,
            status: true,
          },
        });

        let movement = null;
        if (refundMethod === "CASH") {
          const openSessionId = await getOpenCashSessionId(tx, tenantId);
          movement = await insertCashMovementIfPossible(tx, {
            tenantId,
            userId,
            sessionId: openSessionId,
            type: "OUT",
            reason: "WITHDRAWAL",
            amount: refundTotal,
            note: `Refund ${refund.id} for sale ${sale.id}`,
          });
        }

        return {
          refund,
          sale: updatedSale,
          movement,
          auditMeta: {
            refundId: refund.id,
            total: refundTotal,
            method: refundMethod,
            note: cleanNote,
            reason: cleanReason,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 20000,
      }
    );

    await writeAuditLog(prisma, {
      tenantId,
      userId,
      entity: "SALE",
      action: "ADD_PAYMENT",
      entityId: saleId,
      metadata: {
        event: "SALE_REFUNDED",
        ...result.auditMeta,
      },
    });

    return res.status(201).json({
      message: "Refund created",
      refund: result.refund,
      sale: result.sale,
      cashMovement: result.movement
        ? {
            id: result.movement.id,
            type: result.movement.type,
            reason: result.movement.reason,
            amount: String(result.movement.amount),
            note: result.movement.note,
            createdAt: result.movement.created_at,
            createdBy: result.movement.created_by,
          }
        : null,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    const code = err?.code;

    if (code === "SALE_NOT_FOUND" || msg === "SALE_NOT_FOUND") {
      return res.status(404).json({ message: "Sale not found" });
    }

    if (code === "SALE_CANCELLED" || msg === "SALE_CANCELLED") {
      return res.status(400).json({ message: "Cannot refund a cancelled sale" });
    }

    if (msg.startsWith("NOT_IN_SALE:")) {
      return res.status(400).json({ message: "A product is not part of this sale" });
    }

    if (msg.startsWith("REFUND_TOO_MUCH:")) {
      return res.status(400).json({ message: "Refund quantity exceeds remaining sold quantity" });
    }

    if (code === "REFUND_EXCEEDS_PAID" || msg === "REFUND_EXCEEDS_PAID") {
      return res.status(400).json({ message: "Refund total exceeds the amount paid so far" });
    }

    console.error("createSaleRefund error:", err);
    return res.status(500).json({ message: "Failed to create refund" });
  }
}

module.exports = {
  quickPicks,
  createSale,
  createSaleWarranty,
  addSalePayment,
  listSales,
  getSaleReceipt,
  listOutstandingCredit,
  listOverdueCredit,
  cancelSale,
  createSaleRefund,
};