const prisma = require("../../config/database");

function normalizeText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return Boolean(value);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// CREATE
async function createCustomer(req, res) {
  const {
    name,
    phone,
    email,
    address,
    tinNumber,
    idNumber,
    notes,
    whatsappOptIn,
  } = req.body || {};

  const cleanName = normalizeText(name);
  const cleanPhone = normalizePhone(phone);

  if (!cleanName || !cleanPhone) {
    return res.status(400).json({ message: "Name and phone are required" });
  }

  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    return res.status(400).json({ message: "Tenant ID is missing" });
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        name: cleanName,
        phone: cleanPhone,
        ...(email !== undefined ? { email: normalizeText(email) } : {}),
        ...(address !== undefined ? { address: normalizeText(address) } : {}),
        ...(tinNumber !== undefined ? { tinNumber: normalizeText(tinNumber) } : {}),
        ...(idNumber !== undefined ? { idNumber: normalizeText(idNumber) } : {}),
        ...(notes !== undefined ? { notes: normalizeText(notes) } : {}),
        ...(whatsappOptIn !== undefined
          ? { whatsappOptIn: normalizeBoolean(whatsappOptIn, false) }
          : {}),
        ...(typeof prisma.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
      },
    });

    return res.status(201).json(customer);
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Customer with this phone already exists" });
    }

    console.error("Failed to create customer", err);
    return res.status(500).json({ message: "Failed to create customer" });
  }
}

// SEARCH / READ ALL
async function getCustomers(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID is missing" });
    }

    const q = String(req.query.q || "").trim();
    const includeInactive =
      String(req.query.includeInactive || "").toLowerCase() === "true";

    const where = {
      tenantId,
      ...(typeof prisma.customer.fields?.isActive !== "undefined" && !includeInactive
        ? { isActive: true }
        : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              ...(typeof prisma.customer.fields?.email !== "undefined"
                ? [{ email: { contains: q, mode: "insensitive" } }]
                : []),
              ...(typeof prisma.customer.fields?.tinNumber !== "undefined"
                ? [{ tinNumber: { contains: q, mode: "insensitive" } }]
                : []),
              ...(typeof prisma.customer.fields?.idNumber !== "undefined"
                ? [{ idNumber: { contains: q, mode: "insensitive" } }]
                : []),
            ],
          }
        : {}),
    };

    const [customers, creditAgg] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: "desc" },
      }),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          customerId: { not: null },
        },
        _sum: { balanceDue: true },
      }),
    ]);

    const map = new Map();
    for (const row of creditAgg) {
      if (row.customerId) {
        map.set(row.customerId, safeNumber(row._sum.balanceDue, 0));
      }
    }

    const enriched = customers.map((c) => ({
      ...c,
      outstanding: map.get(c.id) || 0,
    }));

    return res.json(enriched);
  } catch (err) {
    console.error("Failed to fetch customers", err);
    return res.status(500).json({ message: "Failed to fetch customers" });
  }
}

// READ ONE
async function getCustomerById(req, res) {
  const { id } = req.params;

  try {
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json(customer);
  } catch (err) {
    console.error("Failed to fetch customer", err);
    return res.status(500).json({ message: "Failed to fetch customer" });
  }
}

// UPDATE
async function updateCustomer(req, res) {
  const { id } = req.params;
  const {
    name,
    phone,
    email,
    address,
    tinNumber,
    idNumber,
    notes,
    whatsappOptIn,
    isActive,
  } = req.body || {};

  try {
    const data = {
      ...(name !== undefined ? { name: normalizeText(name) } : {}),
      ...(phone !== undefined ? { phone: normalizePhone(phone) } : {}),
      ...(email !== undefined ? { email: normalizeText(email) } : {}),
      ...(address !== undefined ? { address: normalizeText(address) } : {}),
      ...(tinNumber !== undefined ? { tinNumber: normalizeText(tinNumber) } : {}),
      ...(idNumber !== undefined ? { idNumber: normalizeText(idNumber) } : {}),
      ...(notes !== undefined ? { notes: normalizeText(notes) } : {}),
      ...(whatsappOptIn !== undefined
        ? { whatsappOptIn: normalizeBoolean(whatsappOptIn, false) }
        : {}),
      ...(isActive !== undefined &&
      typeof prisma.customer.fields?.isActive !== "undefined"
        ? { isActive: Boolean(isActive) }
        : {}),
    };

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No valid customer fields provided" });
    }

    const updated = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data,
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });

    return res.json(customer);
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Customer with this phone already exists" });
    }

    console.error("Failed to update customer", err);
    return res.status(500).json({ message: "Failed to update customer" });
  }
}

// REACTIVATE CUSTOMER
async function reactivateCustomer(req, res) {
  const { id } = req.params;

  try {
    if (typeof prisma.customer.fields?.isActive === "undefined") {
      return res.status(400).json({
        message: "Customer reactivation requires isActive field in schema",
      });
    }

    const result = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId, isActive: false },
      data: { isActive: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Customer not found or not deactivated" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });

    return res.json(customer);
  } catch (err) {
    console.error("Failed to reactivate customer", err);
    return res.status(500).json({ message: "Failed to reactivate customer" });
  }
}

// SOFT DELETE (DEACTIVATE)
async function deactivateCustomer(req, res) {
  const { id } = req.params;

  try {
    if (typeof prisma.customer.fields?.isActive === "undefined") {
      return res.status(400).json({
        message: "Customer deactivation requires isActive field in schema",
      });
    }

    const result = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId, isActive: true },
      data: { isActive: false },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json({ message: "Customer deactivated successfully" });
  } catch (err) {
    console.error("Failed to deactivate customer", err);
    return res.status(500).json({ message: "Failed to deactivate customer" });
  }
}

/**
 * GET /api/customers/:id/ledger
 * Shows:
 * - all sales for customer
 * - payments per sale
 * - totals (total credit, paid, outstanding)
 */
async function getCustomerLedger(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const { id: customerId } = req.params;

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: {
        id: true,
        name: true,
        phone: true,
        ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
        ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
        ...(typeof prisma.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
        ...(typeof prisma.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
        ...(typeof prisma.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const sales = await prisma.sale.findMany({
      where: { tenantId, customerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        total: true,
        saleType: true,
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        items: {
          select: {
            quantity: true,
            price: true,
            product: { select: { name: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "asc" },
          select: { amount: true, method: true, createdAt: true, note: true },
        },
      },
    });

    let totalAll = 0;
    let totalCredit = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;

    for (const s of sales) {
      totalAll += safeNumber(s.total, 0);
      totalPaid += safeNumber(s.amountPaid, 0);
      if (s.saleType === "CREDIT") {
        totalCredit += safeNumber(s.total, 0);
      }
      totalOutstanding += safeNumber(s.balanceDue, 0);
    }

    return res.json({
      customer,
      summary: {
        totalSales: sales.length,
        totalAll,
        totalCredit,
        totalPaid,
        totalOutstanding,
      },
      sales,
    });
  } catch (err) {
    console.error("Failed to fetch ledger", err);
    return res.status(500).json({ message: "Failed to fetch ledger" });
  }
}

/**
 * GET /api/customers/ledger/summary/outstanding
 * Returns top debtors + overall totals
 */
async function getCreditSummary(req, res) {
  try {
    const tenantId = req.user.tenantId;

    const totals = await prisma.sale.aggregate({
      where: { tenantId, saleType: "CREDIT" },
      _sum: { balanceDue: true, total: true, amountPaid: true },
      _count: { _all: true },
    });

    const grouped = await prisma.sale.groupBy({
      by: ["customerId"],
      where: {
        tenantId,
        saleType: "CREDIT",
        balanceDue: { gt: 0 },
        customerId: { not: null },
      },
      _sum: { balanceDue: true },
      orderBy: { _sum: { balanceDue: "desc" } },
      take: 10,
    });

    const customerIds = grouped.map((g) => g.customerId).filter(Boolean);

    const customers = await prisma.customer.findMany({
      where: { tenantId, id: { in: customerIds } },
      select: {
        id: true,
        name: true,
        phone: true,
        ...(typeof prisma.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
      },
    });

    const cMap = new Map(customers.map((c) => [c.id, c]));

    const topDebtors = grouped.map((g) => ({
      customer:
        cMap.get(g.customerId) || {
          id: g.customerId,
          name: "Unknown",
          phone: "",
          ...(typeof prisma.customer.fields?.isActive !== "undefined"
            ? { isActive: false }
            : {}),
        },
      outstanding: safeNumber(g._sum.balanceDue, 0),
    }));

    return res.json({
      totals: {
        creditSalesCount: totals._count._all,
        totalCredit: safeNumber(totals._sum.total, 0),
        totalPaid: safeNumber(totals._sum.amountPaid, 0),
        totalOutstanding: safeNumber(totals._sum.balanceDue, 0),
      },
      topDebtors,
    });
  } catch (err) {
    console.error("Failed to fetch credit summary", err);
    return res.status(500).json({ message: "Failed to fetch credit summary" });
  }
}

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  reactivateCustomer,
  deactivateCustomer,
  getCustomerLedger,
  getCreditSummary,
};