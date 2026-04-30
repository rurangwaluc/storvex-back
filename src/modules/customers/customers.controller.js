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

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function resolveCustomerBranchScope(req) {
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

function applySaleBranchScope(where, scope) {
  const next = { ...(where || {}) };
  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId) {
    next.branchId = scope.branchId;
  }
  return next;
}

function customerSelectShape() {
  return {
    id: true,
    tenantId: true,
    name: true,
    phone: true,
    createdAt: true,
    updatedAt: true,
    ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
    ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
    ...(typeof prisma.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
    ...(typeof prisma.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
    ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
    ...(typeof prisma.customer.fields?.whatsappOptIn !== "undefined"
      ? { whatsappOptIn: true }
      : {}),
    ...(typeof prisma.customer.fields?.isActive !== "undefined" ? { isActive: true } : {}),
  };
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
  const tenantId = req.user?.tenantId;

  if (!cleanName || !cleanPhone) {
    return res.status(400).json({ message: "Name and phone are required" });
  }

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
      select: customerSelectShape(),
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

// LIST / SEARCH
async function getCustomers(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ message: "Tenant ID is missing" });
    }

    const scope = resolveCustomerBranchScope(req);
    const q = String(req.query.q || "").trim();
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";

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
        select: customerSelectShape(),
      }),
      prisma.sale.groupBy({
        by: ["customerId"],
        where: applySaleBranchScope(
          {
            tenantId,
            saleType: "CREDIT",
            balanceDue: { gt: 0 },
            customerId: { not: null },
            isCancelled: false,
          },
          scope
        ),
        _sum: { balanceDue: true },
      }),
    ]);

    const outstandingByCustomerId = new Map();
    for (const row of creditAgg) {
      if (row.customerId) {
        outstandingByCustomerId.set(row.customerId, safeNumber(row._sum?.balanceDue, 0));
      }
    }

    const enriched = customers.map((customer) => ({
      ...customer,
      outstanding: outstandingByCustomerId.get(customer.id) || 0,
    }));

    return res.json({
      customers: enriched,
      count: enriched.length,
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("Failed to fetch customers", err);
    return res.status(500).json({ message: "Failed to fetch customers" });
  }
}

// READ ONE
async function getCustomerById(req, res) {
  const { id } = req.params;

  try {
    const customer = await prisma.customer.findFirst({
      where: {
        id,
        tenantId: req.user?.tenantId,
      },
      select: customerSelectShape(),
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
      ...(isActive !== undefined && typeof prisma.customer.fields?.isActive !== "undefined"
        ? { isActive: Boolean(isActive) }
        : {}),
    };

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "No valid customer fields provided" });
    }

    const updated = await prisma.customer.updateMany({
      where: { id, tenantId: req.user?.tenantId },
      data,
    });

    if (updated.count === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: req.user?.tenantId },
      select: customerSelectShape(),
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

// REACTIVATE
async function reactivateCustomer(req, res) {
  const { id } = req.params;

  try {
    if (typeof prisma.customer.fields?.isActive === "undefined") {
      return res.status(400).json({
        message: "Customer reactivation requires isActive field in schema",
      });
    }

    const result = await prisma.customer.updateMany({
      where: {
        id,
        tenantId: req.user?.tenantId,
        isActive: false,
      },
      data: { isActive: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Customer not found or not deactivated" });
    }

    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: req.user?.tenantId },
      select: customerSelectShape(),
    });

    return res.json(customer);
  } catch (err) {
    console.error("Failed to reactivate customer", err);
    return res.status(500).json({ message: "Failed to reactivate customer" });
  }
}

// DEACTIVATE
async function deactivateCustomer(req, res) {
  const { id } = req.params;

  try {
    if (typeof prisma.customer.fields?.isActive === "undefined") {
      return res.status(400).json({
        message: "Customer deactivation requires isActive field in schema",
      });
    }

    const result = await prisma.customer.updateMany({
      where: {
        id,
        tenantId: req.user?.tenantId,
        isActive: true,
      },
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

// LEDGER
async function getCustomerLedger(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const { id: customerId } = req.params;
    const scope = resolveCustomerBranchScope(req);

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
      where: applySaleBranchScope(
        {
          tenantId,
          customerId,
          isCancelled: false,
        },
        scope
      ),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        branchId: true,
        createdAt: true,
        total: true,
        saleType: true,
        status: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        receiptNumber: true,
        invoiceNumber: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
        items: {
          select: {
            quantity: true,
            price: true,
            product: { select: { name: true } },
          },
        },
        payments: {
          orderBy: { createdAt: "asc" },
          select: {
            amount: true,
            method: true,
            createdAt: true,
            note: true,
            branchId: true,
          },
        },
      },
    });

    let totalAll = 0;
    let totalCredit = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;

    for (const sale of sales) {
      totalAll += safeNumber(sale.total, 0);
      totalPaid += safeNumber(sale.amountPaid, 0);

      if (sale.saleType === "CREDIT") {
        totalCredit += safeNumber(sale.total, 0);
      }

      totalOutstanding += safeNumber(sale.balanceDue, 0);
    }

    return res.json({
      customer,
      branchScope: scope,
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
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("Failed to fetch ledger", err);
    return res.status(500).json({ message: "Failed to fetch ledger" });
  }
}

// CREDIT SUMMARY
async function getCreditSummary(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const scope = resolveCustomerBranchScope(req);

    const totals = await prisma.sale.aggregate({
      where: applySaleBranchScope(
        {
          tenantId,
          saleType: "CREDIT",
          isCancelled: false,
        },
        scope
      ),
      _sum: {
        balanceDue: true,
        total: true,
        amountPaid: true,
      },
      _count: {
        _all: true,
      },
    });

    const grouped = await prisma.sale.groupBy({
      by: ["customerId"],
      where: applySaleBranchScope(
        {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          customerId: { not: null },
          isCancelled: false,
        },
        scope
      ),
      _sum: {
        balanceDue: true,
      },
      orderBy: {
        _sum: { balanceDue: "desc" },
      },
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

    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

    const topDebtors = grouped.map((group) => ({
      customer:
        customerMap.get(group.customerId) || {
          id: group.customerId,
          name: "Unknown",
          phone: "",
          ...(typeof prisma.customer.fields?.isActive !== "undefined"
            ? { isActive: false }
            : {}),
        },
      outstanding: safeNumber(group._sum?.balanceDue, 0),
    }));

    return res.json({
      branchScope: scope,
      totals: {
        creditSalesCount: totals._count?._all || 0,
        totalCredit: safeNumber(totals._sum?.total, 0),
        totalPaid: safeNumber(totals._sum?.amountPaid, 0),
        totalOutstanding: safeNumber(totals._sum?.balanceDue, 0),
      },
      topDebtors,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

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