const prisma = require("../../config/database");

/**
 * Helpers
 */
function normalizeSaleType(value) {
  const v = String(value || "CASH").toUpperCase();
  return v === "CREDIT" ? "CREDIT" : "CASH";
}

function normalizePaymentMethod(value) {
  const v = String(value || "CASH").toUpperCase();
  if (v === "MOMO" || v === "BANK" || v === "OTHER") return v;
  return "CASH";
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeSaleStatus({ saleType, total, amountPaid, dueDate }) {
  const balanceDue = Math.max(0, total - amountPaid);

  if (saleType === "CASH") {
    return { status: "PAID", balanceDue: 0 };
  }

  if (balanceDue <= 0) {
    return { status: "PAID", balanceDue: 0 };
  }

  if (amountPaid > 0 && balanceDue > 0) {
    if (dueDate && new Date(dueDate) < new Date()) {
      return { status: "OVERDUE", balanceDue };
    }
    return { status: "PARTIAL", balanceDue };
  }

  if (dueDate && new Date(dueDate) < new Date()) {
    return { status: "OVERDUE", balanceDue };
  }
  return { status: "UNPAID", balanceDue };
}

/**
 * POST /api/pos/sales
 * Supports:
 * - CASH (default)
 * - CREDIT + optional amountPaid + dueDate
 * - Customer linking by:
 *    - customerId OR
 *    - customerName + customerPhone (auto find/create per tenant)
 */
async function createSale(req, res) {
  try {
    const {
      items,
      customerId,
      customerName,
      customerPhone,
      saleType,
      amountPaid,
      dueDate,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Sale items are required" });
    }

    // Validate items
    for (const item of items) {
      if (!item.productId || !item.quantity) {
        return res.status(400).json({
          message: "Each item must have productId and quantity",
        });
      }
      const q = toNumber(item.quantity, NaN);
      if (!Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ message: "Quantity must be a positive integer" });
      }
    }

    const tenantId = req.user.tenantId;
    const cashierId = req.user.userId;

    const finalSaleType = normalizeSaleType(saleType);
    const paid = Math.max(0, toNumber(amountPaid, 0));
    const parsedDueDate = dueDate ? new Date(dueDate) : null;
    if (dueDate && Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ message: "Invalid dueDate" });
    }

    // Compute total and validate stock
    let total = 0;
    const products = [];

    for (const item of items) {
      const product = await prisma.product.findFirst({
        where: { id: item.productId, tenantId },
        select: { id: true, name: true, sellPrice: true, stockQty: true },
      });

      if (!product) return res.status(404).json({ message: "Product not found" });

      const qty = Number(item.quantity);

      if (product.stockQty < qty) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}`,
        });
      }

      total += product.sellPrice * qty;
      products.push({ product, quantity: qty });
    }

    // CASH sales: auto mark fully paid
    const initialPaid = finalSaleType === "CASH" ? total : Math.min(paid, total);
    if (finalSaleType === "CREDIT" && initialPaid > total) {
      return res.status(400).json({ message: "amountPaid cannot exceed total" });
    }

    const { status, balanceDue } = computeSaleStatus({
      saleType: finalSaleType,
      total,
      amountPaid: initialPaid,
      dueDate: parsedDueDate,
    });

    const result = await prisma.$transaction(async (tx) => {
      // Resolve customer
      let resolvedCustomerId = customerId || null;

      if (!resolvedCustomerId && customerName && customerPhone) {
        const phone = String(customerPhone).trim();
        const name = String(customerName).trim();

        if (!phone || !name) {
          throw new Error("INVALID_CUSTOMER_FIELDS");
        }

        // Find existing by tenant + phone, else create
        const existing = await tx.customer.findFirst({
          where: { tenantId, phone },
          select: { id: true },
        });

        if (existing) {
          resolvedCustomerId = existing.id;
        } else {
          const createdCustomer = await tx.customer.create({
            data: { tenantId, name, phone },
            select: { id: true },
          });
          resolvedCustomerId = createdCustomer.id;
        }
      }

      // Create sale
      const createdSale = await tx.sale.create({
        data: {
          tenantId,
          cashierId,
          customerId: resolvedCustomerId,
          total,
          saleType: finalSaleType,
          amountPaid: initialPaid,
          balanceDue,
          status,
          dueDate: finalSaleType === "CREDIT" ? parsedDueDate : null,
        },
        select: { id: true },
      });

      // Create items + decrement stock
      for (const entry of products) {
        await tx.saleItem.create({
          data: {
            saleId: createdSale.id,
            productId: entry.product.id,
            quantity: entry.quantity,
            price: entry.product.sellPrice,
          },
        });

        await tx.product.update({
          where: { id: entry.product.id },
          data: { stockQty: { decrement: entry.quantity } },
        });
      }

      // Record initial payment if CREDIT and > 0
      if (finalSaleType === "CREDIT" && initialPaid > 0) {
        await tx.salePayment.create({
          data: {
            saleId: createdSale.id,
            tenantId,
            receivedById: cashierId,
            amount: initialPaid,
            method: "CASH",
            note: "Initial payment on credit sale",
          },
        });
      }

      return createdSale;
    });

    return res.status(201).json({
      message: "Sale created successfully",
      saleId: result.id,
      total,
      saleType: finalSaleType,
      amountPaid: initialPaid,
      balanceDue,
      status,
    });
  } catch (err) {
    if (String(err?.message) === "INVALID_CUSTOMER_FIELDS") {
      return res.status(400).json({ message: "customerName and customerPhone are required together" });
    }
    console.error(err);
    return res.status(500).json({ message: "Failed to create sale" });
  }
}

/**
 * POST /api/pos/sales/:id/payments
 */
async function addSalePayment(req, res) {
  try {
    const { tenantId, userId } = req.user;
    const { id: saleId } = req.params;
    const { amount, method, note } = req.body;

    const payAmount = toNumber(amount, NaN);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      return res.status(400).json({ message: "amount must be a positive number" });
    }

    const payMethod = normalizePaymentMethod(method);

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      select: { id: true, total: true, amountPaid: true, saleType: true, dueDate: true },
    });

    if (!sale) return res.status(404).json({ message: "Sale not found" });
    if (sale.saleType !== "CREDIT") {
      return res.status(400).json({ message: "Payments can only be added to CREDIT sales" });
    }

    const newPaid = sale.amountPaid + payAmount;
    if (newPaid > sale.total + 0.000001) {
      return res.status(400).json({ message: "Payment exceeds remaining balance" });
    }

    const { status, balanceDue } = computeSaleStatus({
      saleType: "CREDIT",
      total: sale.total,
      amountPaid: newPaid,
      dueDate: sale.dueDate,
    });

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.salePayment.create({
        data: {
          saleId,
          tenantId,
          receivedById: userId,
          amount: payAmount,
          method: payMethod,
          note: note || null,
        },
      });

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: { amountPaid: newPaid, balanceDue, status },
        select: { id: true, total: true, amountPaid: true, balanceDue: true, status: true },
      });

      return { payment, sale: updatedSale };
    });

    return res.status(201).json({
      message: "Payment recorded",
      sale: result.sale,
      payment: {
        id: result.payment.id,
        amount: result.payment.amount,
        method: result.payment.method,
        createdAt: result.payment.createdAt,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to record payment" });
  }
}

async function listSales(req, res) {
  const { tenantId } = req.user;
  try {
    const sales = await prisma.sale.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        total: true,
        saleType: true,
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        createdAt: true,
        cashier: { select: { name: true } },
        customer: { select: { name: true, phone: true } },
      },
    });
    return res.json(sales);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch sales" });
  }
}

async function getSaleReceipt(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;

  try {
    const sale = await prisma.sale.findFirst({
      where: { id, tenantId },
      include: {
        cashier: { select: { name: true } },
        customer: { select: { name: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
        payments: {
          orderBy: { createdAt: "asc" },
          select: { amount: true, method: true, createdAt: true, note: true },
        },
      },
    });

    if (!sale) return res.status(404).json({ message: "Sale not found" });

    return res.json({
      saleId: sale.id,
      date: sale.createdAt,
      cashier: sale.cashier.name,
      customer: sale.customer,
      total: sale.total,

      saleType: sale.saleType,
      status: sale.status,
      amountPaid: sale.amountPaid,
      balanceDue: sale.balanceDue,
      dueDate: sale.dueDate,

      items: sale.items.map((item) => ({
        product: item.product.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.price * item.quantity,
      })),

      payments: sale.payments,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch receipt" });
  }
}

async function listOutstandingCredit(req, res) {
  try {
    const { tenantId } = req.user;

    const sales = await prisma.sale.findMany({
      where: { tenantId, saleType: "CREDIT", balanceDue: { gt: 0 } },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
      },
    });

    return res.json({ sales });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch outstanding credit" });
  }
}

async function listOverdueCredit(req, res) {
  try {
    const { tenantId } = req.user;
    const now = new Date();

    const sales = await prisma.sale.findMany({
      where: { tenantId, saleType: "CREDIT", balanceDue: { gt: 0 }, dueDate: { lt: now } },
      orderBy: [{ dueDate: "asc" }],
      select: {
        id: true,
        total: true,
        amountPaid: true,
        balanceDue: true,
        status: true,
        dueDate: true,
        createdAt: true,
        customer: { select: { name: true, phone: true } },
      },
    });

    return res.json({ sales });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch overdue credit" });
  }
}

module.exports = {
  createSale,
  addSalePayment,
  listSales,
  getSaleReceipt,
  listOutstandingCredit,
  listOverdueCredit,
};
