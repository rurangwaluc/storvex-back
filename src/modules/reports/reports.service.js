const prisma = require("../../config/database");

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

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function pctChange(current, previous) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (p === 0) return null;
  return ((c - p) / p) * 100;
}

function shiftRangeBackward(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { prevStart: startOfDay(prevStart), prevEnd: endOfDay(prevEnd) };
}

function parseRange(query = {}) {
  const from = parseDateOnly(query.from);
  const to = parseDateOnly(query.to);

  const now = new Date();
  const defaultTo = now;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const start = startOfDay(from || defaultFrom);
  const end = endOfDay(to || defaultTo);

  return { start, end };
}

function getLimit(query = {}, fallback = 10, max = 50) {
  const raw = Number(query.limit);
  return Number.isFinite(raw) && raw > 0 && raw <= max ? Math.floor(raw) : fallback;
}

function getThreshold(query = {}, fallback = 5, max = 10000) {
  const raw = Number(query.threshold);
  return Number.isFinite(raw) && raw >= 0 && raw <= max ? Math.floor(raw) : fallback;
}

async function getBranchMetaMap(tenantId) {
  const rows = await prisma.branch.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
      type: true,
    },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        code: row.code,
        status: row.status,
        isMain: Boolean(row.isMain),
        type: row.type || null,
      },
    ])
  );
}

async function resolveReportBranchScope({ user, query = {} }) {
  const tenantId = user?.tenantId;
  const requestedBranchId =
    cleanString(query.branchId) ||
    cleanString(user?.requestedBranchId) ||
    null;

  const allBranchesRequested =
    String(query.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const canViewAllBranches = Boolean(user?.canViewAllBranches);
  const allowedBranchIds = Array.isArray(user?.allowedBranchIds) ? user.allowedBranchIds : [];
  const defaultBranchId = cleanString(user?.branchId) || cleanString(user?.defaultBranchId);

  if (!tenantId) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const branchMetaMap = await getBranchMetaMap(tenantId);

  if (allBranchesRequested) {
    if (!canViewAllBranches) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      throw err;
    }

    return {
      tenantId,
      mode: "ALL_BRANCHES",
      branchId: null,
      requestedBranchId: null,
      allowedBranchIds,
      canViewAllBranches,
      label: "All branches",
      branch: null,
      branchMetaMap,
    };
  }

  if (requestedBranchId) {
    if (
      !canViewAllBranches &&
      allowedBranchIds.length > 0 &&
      !allowedBranchIds.includes(requestedBranchId)
    ) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      err.branchId = requestedBranchId;
      throw err;
    }

    const branch = branchMetaMap.get(requestedBranchId) || null;

    return {
      tenantId,
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      requestedBranchId,
      allowedBranchIds,
      canViewAllBranches,
      label: branch?.name || branch?.code || requestedBranchId,
      branch,
      branchMetaMap,
    };
  }

  if (defaultBranchId) {
    const branch = branchMetaMap.get(defaultBranchId) || null;

    return {
      tenantId,
      mode: "SINGLE_BRANCH",
      branchId: defaultBranchId,
      requestedBranchId: null,
      allowedBranchIds,
      canViewAllBranches,
      label: branch?.name || branch?.code || defaultBranchId,
      branch,
      branchMetaMap,
    };
  }

  return {
    tenantId,
    mode: "TENANT_FALLBACK",
    branchId: null,
    requestedBranchId: null,
    allowedBranchIds,
    canViewAllBranches,
    label: "Tenant-wide fallback",
    branch: null,
    branchMetaMap,
  };
}

function withBranch(where = {}, branchScope, branchKey = "branchId") {
  const next = { ...where };

  if (branchScope?.mode === "SINGLE_BRANCH" && branchScope?.branchId) {
    next[branchKey] = branchScope.branchId;
  }

  return next;
}

function withSaleBranch(where = {}, branchScope) {
  return withBranch(where, branchScope, "branchId");
}

function withPaymentBranch(where = {}, branchScope) {
  return withBranch(where, branchScope, "branchId");
}

function withExpenseBranch(where = {}, branchScope) {
  return withBranch(where, branchScope, "branchId");
}

function withRepairBranch(where = {}, branchScope) {
  return withBranch(where, branchScope, "branchId");
}

function withStockAdjustmentBranch(where = {}, branchScope) {
  return withBranch(where, branchScope, "branchId");
}

async function getTenantForPdf(tenantId) {
  try {
    if (!tenantId) return null;
    return await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, phone: true, email: true, status: true },
    });
  } catch (e) {
    console.error("getTenantForPdf error:", e);
    return null;
  }
}

function completedSaleWhere(tenantId, start, end) {
  return {
    tenantId,
    createdAt: { gte: start, lte: end },
    isDraft: false,
    isCancelled: false,
  };
}

async function computePeriodSummary(branchScope, start, end) {
  const tenantId = branchScope.tenantId;

  const [salesAgg, expensesAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: withSaleBranch(completedSaleWhere(tenantId, start, end), branchScope),
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: withExpenseBranch(
        {
          tenantId,
          status: "APPROVED",
          approvedAt: { not: null },
          createdAt: { gte: start, lte: end },
        },
        branchScope
      ),
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const revenue = money(salesAgg._sum.total);
  const expensesApproved = money(expensesAgg._sum.amount);
  const profitEstimate = revenue - expensesApproved;

  return {
    salesCount: salesAgg._count._all,
    revenue,
    expensesApproved,
    profitEstimate,
  };
}

async function computeCostOfGoodsSold(branchScope, start, end) {
  const tenantId = branchScope.tenantId;
  const branchId = branchScope.mode === "SINGLE_BRANCH" ? branchScope.branchId : null;

  const rows =
    branchId != null
      ? await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(si.quantity * COALESCE(p."costPrice", 0)), 0)::float8 as "costOfGoodsSold",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "salesFromItems",
          COUNT(si.id)::int as "itemLinesCount",
          COALESCE(SUM(si.quantity), 0)::int as "unitsSold"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."tenantId" = ${tenantId}
          AND s."branchId" = ${branchId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
          AND p."tenantId" = ${tenantId}
      `
      : await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(si.quantity * COALESCE(p."costPrice", 0)), 0)::float8 as "costOfGoodsSold",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "salesFromItems",
          COUNT(si.id)::int as "itemLinesCount",
          COALESCE(SUM(si.quantity), 0)::int as "unitsSold"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."tenantId" = ${tenantId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
          AND p."tenantId" = ${tenantId}
      `;

  const row = rows?.[0] || {};

  return {
    costOfGoodsSold: money(row.costOfGoodsSold),
    salesFromItems: money(row.salesFromItems),
    itemLinesCount: Number(row.itemLinesCount || 0),
    unitsSold: Number(row.unitsSold || 0),
  };
}

async function getReorderSuggestions(branchScope, start, end, limit, threshold) {
  const tenantId = branchScope.tenantId;
  const branchId = branchScope.mode === "SINGLE_BRANCH" ? branchScope.branchId : null;

  const rows =
    branchId != null
      ? await prisma.$queryRaw`
        SELECT
          p.id as "productId",
          p.name as "name",
          COALESCE(bi."qtyOnHand", 0)::int as "stockQty",
          COALESCE(SUM(si.quantity), 0)::int as "soldQty",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "revenue"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        LEFT JOIN "BranchInventory" bi
          ON bi."productId" = p.id
         AND bi."tenantId" = ${tenantId}
         AND bi."branchId" = ${branchId}
        WHERE s."tenantId" = ${tenantId}
          AND s."branchId" = ${branchId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
          AND p."tenantId" = ${tenantId}
          AND p."isActive" = true
          AND COALESCE(bi."qtyOnHand", 0) <= ${threshold}
        GROUP BY p.id, p.name, bi."qtyOnHand"
        ORDER BY "soldQty" DESC, "revenue" DESC
        LIMIT ${limit};
      `
      : await prisma.$queryRaw`
        SELECT
          p.id as "productId",
          p.name as "name",
          p."stockQty"::int as "stockQty",
          COALESCE(SUM(si.quantity), 0)::int as "soldQty",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "revenue"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."tenantId" = ${tenantId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
          AND p."tenantId" = ${tenantId}
          AND p."isActive" = true
          AND p."stockQty" <= ${threshold}
        GROUP BY p.id, p.name, p."stockQty"
        ORDER BY "soldQty" DESC, "revenue" DESC
        LIMIT ${limit};
      `;

  return (rows || []).map((r) => ({
    productId: r.productId,
    name: r.name,
    stockQty: Number(r.stockQty || 0),
    soldQty: Number(r.soldQty || 0),
    revenue: money(r.revenue),
  }));
}

async function getOverdueCollections(branchScope, limit) {
  const tenantId = branchScope.tenantId;
  const now = new Date();

  const grouped = await prisma.sale.groupBy({
    by: ["customerId"],
    where: withSaleBranch(
      {
        tenantId,
        saleType: "CREDIT",
        balanceDue: { gt: 0 },
        dueDate: { lt: now },
        customerId: { not: null },
        isDraft: false,
        isCancelled: false,
      },
      branchScope
    ),
    _sum: { balanceDue: true },
    _count: { _all: true },
    orderBy: { _sum: { balanceDue: "desc" } },
    take: limit,
  });

  const ids = grouped.map((g) => g.customerId).filter(Boolean);
  if (!ids.length) return [];

  const customers = await prisma.customer.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, name: true, phone: true },
  });

  const byId = new Map(customers.map((c) => [c.id, c]));

  return grouped
    .map((g) => {
      const c = byId.get(g.customerId);
      if (!c) return null;
      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        overdueSalesCount: g._count._all,
        overdueAmount: money(g._sum.balanceDue),
      };
    })
    .filter(Boolean);
}

async function buildSalesSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const tenantId = branchScope.tenantId;

  const [salesAgg, paymentsAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: withSaleBranch(completedSaleWhere(tenantId, start, end), branchScope),
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.salePayment.aggregate({
      where: withPaymentBranch(
        { tenantId, createdAt: { gte: start, lte: end } },
        branchScope
      ),
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    salesCount: salesAgg._count._all,
    salesTotal: money(salesAgg._sum.total),
    paymentsCount: paymentsAgg._count._all,
    paymentsTotal: money(paymentsAgg._sum.amount),
  };
}

async function buildExpenseSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const tenantId = branchScope.tenantId;

  const agg = await prisma.expense.aggregate({
    where: withExpenseBranch(
      {
        tenantId,
        status: "APPROVED",
        approvedAt: { not: null },
        createdAt: { gte: start, lte: end },
      },
      branchScope
    ),
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    approvedExpenseCount: agg._count._all,
    approvedExpenseTotal: money(agg._sum.amount),
  };
}

async function buildRepairSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const tenantId = branchScope.tenantId;

  const all = await prisma.repair.findMany({
    where: withRepairBranch(
      { tenantId, createdAt: { gte: start, lte: end } },
      branchScope
    ),
    select: { status: true },
  });

  const counts = { RECEIVED: 0, IN_PROGRESS: 0, COMPLETED: 0, DELIVERED: 0 };
  for (const r of all) {
    if (counts[r.status] != null) counts[r.status] += 1;
  }

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    total: all.length,
    byStatus: counts,
  };
}

async function buildDashboardSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const tenantId = branchScope.tenantId;

  const [sales, expenses, repairs] = await Promise.all([
    prisma.sale.aggregate({
      where: withSaleBranch(completedSaleWhere(tenantId, start, end), branchScope),
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.expense.aggregate({
      where: withExpenseBranch(
        {
          tenantId,
          status: "APPROVED",
          approvedAt: { not: null },
          createdAt: { gte: start, lte: end },
        },
        branchScope
      ),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.repair.groupBy({
      by: ["status"],
      where: withRepairBranch(
        { tenantId, createdAt: { gte: start, lte: end } },
        branchScope
      ),
      _count: { _all: true },
    }),
  ]);

  const repairsByStatus = {};
  for (const row of repairs) repairsByStatus[row.status] = row._count._all;

  const revenue = money(sales._sum.total);
  const cost = money(expenses._sum.amount);

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    sales: { count: sales._count._all, total: revenue },
    expenses: { approvedCount: expenses._count._all, approvedTotal: cost },
    profitEstimate: revenue - cost,
    repairs: { byStatus: repairsByStatus },
  };
}

async function buildTopSellers({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const limit = getLimit(query, 10, 50);
  const tenantId = branchScope.tenantId;
  const branchId = branchScope.mode === "SINGLE_BRANCH" ? branchScope.branchId : null;

  const rows =
    branchId != null
      ? await prisma.$queryRaw`
        SELECT
          p.id as "productId",
          p.name as "name",
          COALESCE(SUM(si.quantity), 0)::int as "soldQty",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "revenue"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."tenantId" = ${tenantId}
          AND s."branchId" = ${branchId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
        GROUP BY p.id, p.name
        ORDER BY "soldQty" DESC, "revenue" DESC
        LIMIT ${limit};
      `
      : await prisma.$queryRaw`
        SELECT
          p.id as "productId",
          p.name as "name",
          COALESCE(SUM(si.quantity), 0)::int as "soldQty",
          COALESCE(SUM(si.quantity * si.price), 0)::float8 as "revenue"
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."tenantId" = ${tenantId}
          AND s."createdAt" >= ${start}
          AND s."createdAt" <= ${end}
          AND COALESCE(s."isDraft", false) = false
          AND COALESCE(s."isCancelled", false) = false
        GROUP BY p.id, p.name
        ORDER BY "soldQty" DESC, "revenue" DESC
        LIMIT ${limit};
      `;

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    limit,
    topSellers: (rows || []).map((r) => ({
      productId: r.productId,
      name: r.name,
      soldQty: Number(r.soldQty || 0),
      revenue: money(r.revenue),
    })),
  };
}

async function buildDailyClose({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const tenantId = branchScope.tenantId;

  const dateParam = parseDateOnly(query?.date);
  const base = dateParam || new Date();

  const start = startOfDay(base);
  const end = endOfDay(base);
  const now = new Date();

  const [cashSalesAgg, creditSalesAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: withSaleBranch(
        {
          tenantId,
          createdAt: { gte: start, lte: end },
          saleType: "CASH",
          isDraft: false,
          isCancelled: false,
        },
        branchScope
      ),
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: withSaleBranch(
        {
          tenantId,
          createdAt: { gte: start, lte: end },
          saleType: "CREDIT",
          isDraft: false,
          isCancelled: false,
        },
        branchScope
      ),
      _sum: { total: true, balanceDue: true, amountPaid: true },
      _count: { _all: true },
    }),
  ]);

  const paymentsTodayAgg = await prisma.salePayment.aggregate({
    where: withPaymentBranch(
      { tenantId, createdAt: { gte: start, lte: end } },
      branchScope
    ),
    _sum: { amount: true },
    _count: { _all: true },
  });

  const expensesTodayAgg = await prisma.expense.aggregate({
    where: withExpenseBranch(
      {
        tenantId,
        status: "APPROVED",
        approvedAt: { not: null },
        createdAt: { gte: start, lte: end },
      },
      branchScope
    ),
    _sum: { amount: true },
    _count: { _all: true },
  });

  const [outstandingAgg, overdueAgg] = await Promise.all([
    prisma.sale.aggregate({
      where: withSaleBranch(
        {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          isDraft: false,
          isCancelled: false,
        },
        branchScope
      ),
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
    prisma.sale.aggregate({
      where: withSaleBranch(
        {
          tenantId,
          saleType: "CREDIT",
          balanceDue: { gt: 0 },
          dueDate: { lt: now },
          isDraft: false,
          isCancelled: false,
        },
        branchScope
      ),
      _sum: { balanceDue: true },
      _count: { _all: true },
    }),
  ]);

  const topGrouped = await prisma.saleItem.groupBy({
    by: ["productId"],
    where: {
      sale: withSaleBranch(
        {
          tenantId,
          createdAt: { gte: start, lte: end },
          isDraft: false,
          isCancelled: false,
        },
        branchScope
      ),
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 10,
  });

  const topIds = topGrouped.map((g) => g.productId);

  let topSellers = [];
  if (topIds.length) {
    const products = await prisma.product.findMany({
      where: { tenantId, id: { in: topIds } },
      select: { id: true, name: true },
    });

    const byId = new Map(products.map((p) => [p.id, p]));

    topSellers = topGrouped
      .map((g) => {
        const p = byId.get(g.productId);
        if (!p) return null;
        return { productId: p.id, name: p.name, soldQty: Number(g._sum.quantity || 0) };
      })
      .filter(Boolean);
  }

  const cashSalesTotal = money(cashSalesAgg._sum.total);
  const creditSalesTotal = money(creditSalesAgg._sum.total);

  const cashCollectedToday = cashSalesTotal + money(paymentsTodayAgg._sum.amount);
  const revenueToday = cashSalesTotal + creditSalesTotal;
  const expensesToday = money(expensesTodayAgg._sum.amount);

  return {
    branchScope,
    date: isoDate(start),
    range: { from: start.toISOString(), to: end.toISOString() },
    sales: {
      cash: { count: cashSalesAgg._count._all, total: cashSalesTotal },
      credit: {
        count: creditSalesAgg._count._all,
        total: creditSalesTotal,
        amountPaid: money(creditSalesAgg._sum.amountPaid),
        balanceDue: money(creditSalesAgg._sum.balanceDue),
      },
      revenueToday,
    },
    payments: {
      count: paymentsTodayAgg._count._all,
      total: money(paymentsTodayAgg._sum.amount),
    },
    cashCollectedToday,
    expenses: {
      approvedCount: expensesTodayAgg._count._all,
      approvedTotal: expensesToday,
    },
    profitEstimateToday: revenueToday - expensesToday,
    creditExposure: {
      outstandingCount: outstandingAgg._count._all,
      outstandingTotal: money(outstandingAgg._sum.balanceDue),
      overdueCount: overdueAgg._count._all,
      overdueTotal: money(overdueAgg._sum.balanceDue),
    },
    topSellers,
  };
}

async function buildInsights({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const limit = getLimit(query, 10, 50);
  const threshold = getThreshold(query, 5, 10000);

  const { prevStart, prevEnd } = shiftRangeBackward(start, end);

  const [current, previous, reorderList, collectionsList] = await Promise.all([
    computePeriodSummary(branchScope, start, end),
    computePeriodSummary(branchScope, prevStart, prevEnd),
    getReorderSuggestions(branchScope, start, end, limit, threshold),
    getOverdueCollections(branchScope, limit),
  ]);

  const delta = {
    revenue: money(current.revenue) - money(previous.revenue),
    expenses: money(current.expensesApproved) - money(previous.expensesApproved),
    profit: money(current.profitEstimate) - money(previous.profitEstimate),
    salesCount: Number(current.salesCount || 0) - Number(previous.salesCount || 0),
  };

  const percent = {
    revenue: pctChange(current.revenue, previous.revenue),
    expenses: pctChange(current.expensesApproved, previous.expensesApproved),
    profit: pctChange(current.profitEstimate, previous.profitEstimate),
  };

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    previousRange: { from: prevStart.toISOString(), to: prevEnd.toISOString() },
    comparison: { current, previous, delta, percent },
    reorderSuggestions: { threshold, items: reorderList },
    collections: { items: collectionsList },
  };
}

async function buildFinancialSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);

  const [period, cogs, topSellers, stockAdjustments] = await Promise.all([
    computePeriodSummary(branchScope, start, end),
    computeCostOfGoodsSold(branchScope, start, end),
    buildTopSellers({ user, query }),
    prisma.stockAdjustment.aggregate({
      where: withStockAdjustmentBranch(
        { tenantId: branchScope.tenantId, createdAt: { gte: start, lte: end } },
        branchScope
      ),
      _count: { _all: true },
    }),
  ]);

  const revenue = money(period.revenue);
  const approvedExpenses = money(period.expensesApproved);
  const costOfGoodsSold = money(cogs.costOfGoodsSold);
  const grossProfit = revenue - costOfGoodsSold;
  const profitEstimate = grossProfit - approvedExpenses;

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    summary: {
      revenue,
      costOfGoodsSold,
      grossProfit,
      approvedExpenses,
      profitEstimate,
      salesCount: period.salesCount,
      itemLinesCount: cogs.itemLinesCount,
      unitsSold: cogs.unitsSold,
      stockAdjustmentsCount: stockAdjustments._count._all,
    },
    topSellers: topSellers.topSellers,
  };
}

async function buildIncomeStatement({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);

  const [period, cogs] = await Promise.all([
    computePeriodSummary(branchScope, start, end),
    computeCostOfGoodsSold(branchScope, start, end),
  ]);

  const revenue = money(period.revenue);
  const operatingExpenses = money(period.expensesApproved);
  const costOfGoodsSold = money(cogs.costOfGoodsSold);

  const grossProfit = revenue - costOfGoodsSold;
  const netIncomeEstimate = grossProfit - operatingExpenses;

  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const netMargin = revenue > 0 ? (netIncomeEstimate / revenue) * 100 : null;

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },
    incomeStatement: {
      revenue,

      costOfGoodsSold,
      grossProfit,
      grossMargin,

      operatingExpenses,
      netIncomeEstimate,
      netMargin,

      salesCount: Number(period.salesCount || 0),
      itemLinesCount: cogs.itemLinesCount,
      unitsSold: cogs.unitsSold,

      dataQuality: {
        costSource: "Product.costPrice",
        salesSource: "Sale + SaleItem",
        expensesSource: "Approved Expense",
        excludesDraftSales: true,
        excludesCancelledSales: true,
      },
    },
  };
}

function normalizePaymentMethod(method) {
  const value = String(method || "OTHER").trim().toUpperCase();

  if (value === "CASH") return "CASH";
  if (value === "MOMO" || value === "MOBILE_MONEY" || value === "MTN_MOMO") return "MOMO";
  if (value === "BANK" || value === "BANK_TRANSFER" || value === "TRANSFER") return "BANK";
  if (value === "CARD" || value === "VISA" || value === "MASTERCARD") return "CARD";

  return "OTHER";
}

function normalizeMovementReason(reason) {
  const value = String(reason || "OTHER").trim().toUpperCase();

  if (value === "FLOAT") return "FLOAT";
  if (value === "WITHDRAWAL") return "WITHDRAWAL";
  if (value === "DEPOSIT") return "DEPOSIT";
  if (value === "EXPENSE") return "EXPENSE";

  return "OTHER";
}

function emptyMethodSplit() {
  return {
    CASH: { method: "CASH", label: "Cash", amount: 0, count: 0 },
    MOMO: { method: "MOMO", label: "Mobile money", amount: 0, count: 0 },
    BANK: { method: "BANK", label: "Bank", amount: 0, count: 0 },
    CARD: { method: "CARD", label: "Card", amount: 0, count: 0 },
    OTHER: { method: "OTHER", label: "Other", amount: 0, count: 0 },
  };
}

function splitToArray(split) {
  return ["CASH", "MOMO", "BANK", "CARD", "OTHER"].map((key) => split[key]);
}

async function tableColumnExists(tableName, columnName) {
  const rows = await prisma.$queryRaw`
    select 1 as ok
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${String(tableName)}
      and column_name = ${String(columnName)}
    limit 1
  `;

  return Boolean(rows?.[0]?.ok);
}

async function getCashSessionSummary({ tenantId, branchScope, start, end }) {
  const hasCashSessionBranchId = await tableColumnExists("cash_sessions", "branch_id");

  if (branchScope?.mode === "SINGLE_BRANCH" && branchScope?.branchId && hasCashSessionBranchId) {
    const rows = await prisma.$queryRaw`
      select
        COALESCE(SUM(opening_cash), 0)::float8 as "openingCash",
        COALESCE(SUM(counted_cash), 0)::float8 as "countedCash",
        COUNT(*)::int as "sessionCount",
        COUNT(*) filter (where closed_at is null)::int as "openSessionCount",
        MAX(opened_at) as "latestOpenedAt",
        MAX(closed_at) as "latestClosedAt"
      from public.cash_sessions
      where tenant_id::text = ${String(tenantId)}::text
        and branch_id::text = ${String(branchScope.branchId)}::text
        and opened_at >= ${start}
        and opened_at <= ${end}
    `;

    return {
      openingCash: money(rows?.[0]?.openingCash),
      countedCash: money(rows?.[0]?.countedCash),
      sessionCount: Number(rows?.[0]?.sessionCount || 0),
      openSessionCount: Number(rows?.[0]?.openSessionCount || 0),
      latestOpenedAt: rows?.[0]?.latestOpenedAt || null,
      latestClosedAt: rows?.[0]?.latestClosedAt || null,
      branchFiltered: true,
    };
  }

  const rows = await prisma.$queryRaw`
    select
      COALESCE(SUM(opening_cash), 0)::float8 as "openingCash",
      COALESCE(SUM(counted_cash), 0)::float8 as "countedCash",
      COUNT(*)::int as "sessionCount",
      COUNT(*) filter (where closed_at is null)::int as "openSessionCount",
      MAX(opened_at) as "latestOpenedAt",
      MAX(closed_at) as "latestClosedAt"
    from public.cash_sessions
    where tenant_id::text = ${String(tenantId)}::text
      and opened_at >= ${start}
      and opened_at <= ${end}
  `;

  return {
    openingCash: money(rows?.[0]?.openingCash),
    countedCash: money(rows?.[0]?.countedCash),
    sessionCount: Number(rows?.[0]?.sessionCount || 0),
    openSessionCount: Number(rows?.[0]?.openSessionCount || 0),
    latestOpenedAt: rows?.[0]?.latestOpenedAt || null,
    latestClosedAt: rows?.[0]?.latestClosedAt || null,
    branchFiltered: !(branchScope?.mode === "SINGLE_BRANCH" && branchScope?.branchId),
  };
}

async function getCashMovementSummary({ tenantId, branchScope, start, end }) {
  const hasCashMovementBranchId = await tableColumnExists("cash_movements", "branch_id");

  const rows =
    branchScope?.mode === "SINGLE_BRANCH" && branchScope?.branchId && hasCashMovementBranchId
      ? await prisma.$queryRaw`
        select
          type::text as "type",
          reason::text as "reason",
          COALESCE(SUM(amount), 0)::float8 as "amount",
          COUNT(*)::int as "count"
        from public.cash_movements
        where tenant_id::text = ${String(tenantId)}::text
          and branch_id::text = ${String(branchScope.branchId)}::text
          and created_at >= ${start}
          and created_at <= ${end}
        group by type, reason
      `
      : await prisma.$queryRaw`
        select
          type::text as "type",
          reason::text as "reason",
          COALESCE(SUM(amount), 0)::float8 as "amount",
          COUNT(*)::int as "count"
        from public.cash_movements
        where tenant_id::text = ${String(tenantId)}::text
          and created_at >= ${start}
          and created_at <= ${end}
        group by type, reason
      `;

  const byReason = {};
  let drawerCashIn = 0;
  let drawerCashOut = 0;
  let drawerMovementCount = 0;

  for (const row of rows || []) {
    const type = String(row.type || "").toUpperCase();
    const reason = normalizeMovementReason(row.reason);
    const amount = money(row.amount);
    const count = Number(row.count || 0);

    drawerMovementCount += count;

    if (!byReason[reason]) {
      byReason[reason] = {
        reason,
        label:
          reason === "FLOAT"
            ? "Opening/float money"
            : reason === "WITHDRAWAL"
              ? "Withdrawals"
              : reason === "DEPOSIT"
                ? "Deposits"
                : reason === "EXPENSE"
                  ? "Cash expenses"
                  : "Other drawer movement",
        moneyIn: 0,
        moneyOut: 0,
        count: 0,
      };
    }

    byReason[reason].count += count;

    if (type === "IN") {
      drawerCashIn += amount;
      byReason[reason].moneyIn += amount;
    }

    if (type === "OUT") {
      drawerCashOut += amount;
      byReason[reason].moneyOut += amount;
    }
  }

  return {
    drawerCashIn,
    drawerCashOut,
    drawerNetMovement: drawerCashIn - drawerCashOut,
    drawerMovementCount,
    byReason: Object.values(byReason),
    branchFiltered: branchScope?.mode === "SINGLE_BRANCH" && branchScope?.branchId && hasCashMovementBranchId,
  };
}

async function buildCashFlowSummary({ user, query }) {
  const branchScope = await resolveReportBranchScope({ user, query });
  const { start, end } = parseRange(query);
  const tenantId = branchScope.tenantId;

  const [
    paymentRows,
    approvedExpensesAgg,
    cashSessionSummary,
    cashMovementSummary,
  ] = await Promise.all([
    prisma.salePayment.groupBy({
      by: ["method"],
      where: withPaymentBranch(
        {
          tenantId,
          createdAt: { gte: start, lte: end },
        },
        branchScope
      ),
      _sum: { amount: true },
      _count: { _all: true },
    }),

    prisma.expense.aggregate({
      where: withExpenseBranch(
        {
          tenantId,
          status: "APPROVED",
          approvedAt: { not: null },
          createdAt: { gte: start, lte: end },
        },
        branchScope
      ),
      _sum: { amount: true },
      _count: { _all: true },
    }),

    getCashSessionSummary({
      tenantId,
      branchScope,
      start,
      end,
    }),

    getCashMovementSummary({
      tenantId,
      branchScope,
      start,
      end,
    }),
  ]);

  const methodSplit = emptyMethodSplit();

  for (const row of paymentRows || []) {
    const method = normalizePaymentMethod(row.method);
    const amount = money(row._sum?.amount);
    const count = Number(row._count?._all || 0);

    methodSplit[method].amount += amount;
    methodSplit[method].count += count;
  }

  const paymentMethodSplit = splitToArray(methodSplit);

  const moneyInFromPayments = paymentMethodSplit.reduce(
    (sum, row) => sum + money(row.amount),
    0
  );

  const approvedExpenses = money(approvedExpensesAgg._sum?.amount);
  const approvedExpenseCount = Number(approvedExpensesAgg._count?._all || 0);

  const drawerCashIn = money(cashMovementSummary.drawerCashIn);
  const drawerCashOut = money(cashMovementSummary.drawerCashOut);

  const openingCash = money(cashSessionSummary.openingCash);
  const countedCash = money(cashSessionSummary.countedCash);

  const expectedClosingCash = openingCash + drawerCashIn - drawerCashOut;

  const moneyIn = moneyInFromPayments;
  const moneyOut = approvedExpenses;
  const netCashFlow = moneyIn - moneyOut;

  return {
    branchScope,
    range: { from: start.toISOString(), to: end.toISOString() },

    cashFlow: {
      moneyIn,
      moneyOut,
      netCashFlow,

      openingCash,
      expectedClosingCash,
      countedCash,
      cashDifference: countedCash > 0 ? countedCash - expectedClosingCash : null,

      sessionCount: cashSessionSummary.sessionCount,
      openSessionCount: cashSessionSummary.openSessionCount,
      latestOpenedAt: cashSessionSummary.latestOpenedAt,
      latestClosedAt: cashSessionSummary.latestClosedAt,

      paymentMethodSplit,

      moneyInBreakdown: [
        {
          key: "PAYMENTS_RECEIVED",
          label: "Payments received",
          amount: moneyInFromPayments,
          count: paymentMethodSplit.reduce((sum, row) => sum + Number(row.count || 0), 0),
        },
        {
          key: "DRAWER_MONEY_IN",
          label: "Cash drawer money in",
          amount: drawerCashIn,
          count: Number(cashMovementSummary.drawerMovementCount || 0),
        },
      ],

      moneyOutBreakdown: [
        {
          key: "APPROVED_EXPENSES",
          label: "Approved expenses",
          amount: approvedExpenses,
          count: approvedExpenseCount,
        },
        {
          key: "DRAWER_MONEY_OUT",
          label: "Cash drawer money out",
          amount: drawerCashOut,
          count: Number(cashMovementSummary.drawerMovementCount || 0),
        },
      ],

      drawerBreakdown: {
        drawerCashIn,
        drawerCashOut,
        drawerNetMovement: drawerCashIn - drawerCashOut,
        byReason: cashMovementSummary.byReason,
      },

      breakdown: {
        cashPayments: methodSplit.CASH.amount,
        momoPayments: methodSplit.MOMO.amount,
        bankPayments: methodSplit.BANK.amount,
        cardPayments: methodSplit.CARD.amount,
        otherPayments: methodSplit.OTHER.amount,
        approvedExpenses,
      },
    },

    dataQuality: {
      paymentMethodSplitSource: "SalePayment",
      drawerSource: "cash_sessions + cash_movements",
      cashSessionsBranchFiltered: Boolean(cashSessionSummary.branchFiltered),
      cashMovementsBranchFiltered: Boolean(cashMovementSummary.branchFiltered),
    },
  };
}

async function buildBranchPerformance({ user, query }) {
  const tenantId = user?.tenantId;
  const canViewAllBranches = Boolean(user?.canViewAllBranches);
  const { start, end } = parseRange(query);

  if (!tenantId) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  if (!canViewAllBranches) {
    const err = new Error("Branch performance requires owner/manager access");
    err.status = 403;
    err.code = "BRANCH_REPORT_FORBIDDEN";
    throw err;
  }

  const branches = await prisma.branch.findMany({
    where: {
      tenantId,
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      status: true,
      isMain: true,
    },
    orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
  });

  const items = await Promise.all(
    branches.map(async (branch) => {
      const branchScope = {
        tenantId,
        mode: "SINGLE_BRANCH",
        branchId: branch.id,
        requestedBranchId: branch.id,
        allowedBranchIds: [],
        canViewAllBranches: true,
        label: branch.name,
        branch,
        branchMetaMap: new Map([[branch.id, branch]]),
      };

      const period = await computePeriodSummary(branchScope, start, end);

      return {
        branch: {
          id: branch.id,
          name: branch.name,
          code: branch.code,
          type: branch.type,
          status: branch.status,
          isMain: Boolean(branch.isMain),
        },
        salesCount: period.salesCount,
        revenue: period.revenue,
        approvedExpenses: period.expensesApproved,
        profitEstimate: period.profitEstimate,
      };
    })
  );

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    branches: items,
  };
}

module.exports = {
  parseRange,
  resolveReportBranchScope,
  computePeriodSummary,
  getReorderSuggestions,
  getOverdueCollections,
  getTenantForPdf,
  buildSalesSummary,
  buildExpenseSummary,
  buildRepairSummary,
  buildDashboardSummary,
  buildTopSellers,
  buildDailyClose,
  buildInsights,
  buildFinancialSummary,
  buildIncomeStatement,
  buildCashFlowSummary,
  buildBranchPerformance,
};