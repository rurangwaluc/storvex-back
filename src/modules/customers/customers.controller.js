const prisma = require("../../config/database");

// CREATE
async function createCustomer(req, res) {
  const { name, phone } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ message: "Name and phone are required" });
  }

  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(400).json({ message: "Tenant ID is missing" });

  try {
    // With UNIQUE(tenantId, phone) in DB, this prevents duplicates.
    // If phone already exists, return a clear error.
    const customer = await prisma.customer.create({
      data: { tenantId, name: String(name).trim(), phone: String(phone).trim() },
    });

    return res.status(201).json(customer);
  } catch (err) {
    // Prisma unique violation is P2002
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Customer with this phone already exists" });
    }
    console.error("Failed to create customer", err);
    return res.status(500).json({ message: "Failed to create customer" });
  }
}

// READ ALL (with outstanding credit per customer)
async function getCustomers(req, res) {
  try {
    const tenantId = req.user.tenantId;

    // Return customers + outstanding credit (sum of balanceDue of credit sales)
    // We do it with groupBy to keep it fast.
    const [customers, creditAgg] = await Promise.all([
      prisma.customer.findMany({
        where: { tenantId },
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
      if (row.customerId) map.set(row.customerId, row._sum.balanceDue || 0);
    }

    const enriched = customers.map((c) => ({
      ...c,
      outstanding: map.get(c.id) || 0,
    }));

    return res.json(enriched);
  } catch (err) {
    console.error(err);
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

    if (!customer) return res.status(404).json({ message: "Customer not found" });

    return res.json(customer);
  } catch (err) {
    console.error("Failed to fetch customer", err);
    return res.status(500).json({ message: "Failed to fetch customer" });
  }
}

// UPDATE
async function updateCustomer(req, res) {
  const { id } = req.params;
  const { name, phone } = req.body;

  try {
    const updated = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data: {
        ...(name ? { name: String(name).trim() } : {}),
        ...(phone ? { phone: String(phone).trim() } : {}),
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json({ message: "Customer updated successfully" });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ message: "Customer with this phone already exists" });
    }
    console.error("Failed to update customer", err);
    return res.status(500).json({ message: "Failed to update customer" });
  }
}

// REACTIVATE CUSTOMER (soft restore)
async function reactivateCustomer(req, res) {
  const { id } = req.params;

  try {
    const result = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId, name: "[DEACTIVATED]" },
      data: { name: "Restored Customer" },
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
    const result = await prisma.customer.updateMany({
      where: { id, tenantId: req.user.tenantId },
      data: { name: "[DEACTIVATED]" },
    });

    if (result.count === 0) return res.status(404).json({ message: "Customer not found" });

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
      select: { id: true, name: true, phone: true },
    });

    if (!customer) return res.status(404).json({ message: "Customer not found" });

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

    // Summaries
    let totalAll = 0;
    let totalCredit = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;

    for (const s of sales) {
      totalAll += s.total;
      totalPaid += s.amountPaid || 0;
      if (s.saleType === "CREDIT") totalCredit += s.total;
      totalOutstanding += s.balanceDue || 0;
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
    console.error(err);
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

    // Total outstanding
    const totals = await prisma.sale.aggregate({
      where: { tenantId, saleType: "CREDIT" },
      _sum: { balanceDue: true, total: true, amountPaid: true },
      _count: { _all: true },
    });

    // Top debtors (by sum(balanceDue))
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
      select: { id: true, name: true, phone: true },
    });

    const cMap = new Map(customers.map((c) => [c.id, c]));

    const topDebtors = grouped.map((g) => ({
      customer: cMap.get(g.customerId) || { id: g.customerId, name: "Unknown", phone: "" },
      outstanding: g._sum.balanceDue || 0,
    }));

    return res.json({
      totals: {
        creditSalesCount: totals._count._all,
        totalCredit: totals._sum.total || 0,
        totalPaid: totals._sum.amountPaid || 0,
        totalOutstanding: totals._sum.balanceDue || 0,
      },
      topDebtors,
    });
  } catch (err) {
    console.error(err);
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
