const prisma = require("../../config/database");

function money(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
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

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function safeDateLabel(value, prefix = "Ends") {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${prefix} ${d.toLocaleDateString()}`;
}

function diffDaysFromNow(endDateValue) {
  if (!endDateValue) return null;

  const now = new Date();
  const end = new Date(endDateValue);

  if (Number.isNaN(end.getTime())) return null;

  const ms = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function formatSubscriptionState(subscription) {
  if (!subscription) {
    return {
      label: "No subscription",
      tone: "warning",
      detail: "No commercial access data",
      canOperate: false,
      planKey: null,
      endDate: null,
      daysLeft: null,
      accessMode: null,
      status: null,
    };
  }

  const status = String(subscription.status || "").trim().toUpperCase();
  const accessMode = String(subscription.accessMode || "").trim().toUpperCase();

  const isExpired = status === "EXPIRED";
  const isReadOnly = status === "READ_ONLY" || accessMode === "READ_ONLY";
  const isTrial = status === "TRIAL" || accessMode === "TRIAL";

  const computedDaysLeft = diffDaysFromNow(
    subscription.trialEndDate || subscription.endDate || null
  );

  if (isExpired) {
    return {
      label: "Expired",
      tone: "danger",
      detail:
        safeDateLabel(subscription.endDate, "Ended") ||
        "Renew to continue operations",
      canOperate: false,
      planKey: subscription.planKey || null,
      endDate: subscription.endDate || null,
      daysLeft: computedDaysLeft,
      accessMode,
      status,
    };
  }

  if (isReadOnly) {
    return {
      label: "Read-only",
      tone: "warning",
      detail:
        safeDateLabel(subscription.graceEndDate, "Grace ends") ||
        safeDateLabel(subscription.readOnlySince, "Read-only since") ||
        safeDateLabel(subscription.endDate, "Ends") ||
        "Limited access",
      canOperate: false,
      planKey: subscription.planKey || null,
      endDate: subscription.endDate || null,
      daysLeft: computedDaysLeft,
      accessMode,
      status,
    };
  }

  if (isTrial) {
    return {
      label: "Trial",
      tone: "info",
      detail: `${computedDaysLeft ?? 0} day${computedDaysLeft === 1 ? "" : "s"} left`,
      canOperate: true,
      planKey: subscription.planKey || null,
      endDate: subscription.trialEndDate || subscription.endDate || null,
      daysLeft: computedDaysLeft,
      accessMode,
      status,
    };
  }

  return {
    label: "Active",
    tone: "success",
    detail:
      safeDateLabel(subscription.endDate, "Ends") ||
      "Commercial access active",
    canOperate: true,
    planKey: subscription.planKey || null,
    endDate: subscription.endDate || null,
    daysLeft: computedDaysLeft,
    accessMode,
    status,
  };
}

/**
 * GET /api/dashboard
 * Returns dashboard numbers the store needs.
 */
async function getTenantDashboard(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);

    const thresholdRaw = Number(process.env.LOW_STOCK_THRESHOLD || 5);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 1 && thresholdRaw <= 9999
        ? Math.floor(thresholdRaw)
        : 5;

    const [
      tenant,
      todaySalesAgg,
      monthSalesAgg,
      productCount,
      lowStockCount,
      outOfStockCount,
      lowStockProducts,
      activeRepairs,
      pendingDeals,
      recentAudit,
    ] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          district: true,
          sector: true,
          shopType: true,
          logoUrl: true,
          subscription: {
            select: {
              id: true,
              tenantId: true,
              planKey: true,
              status: true,
              accessMode: true,
              tierKey: true,
              cycleKey: true,
              staffLimit: true,
              priceAmount: true,
              currency: true,
              startDate: true,
              endDate: true,
              trialStartDate: true,
              trialEndDate: true,
              readOnlySince: true,
              graceEndDate: true,
              lastPaymentAt: true,
              renewedAt: true,
              createdAt: true,
              trialConsumed: true,
              trialSourceIntentId: true,
              nextPlanKey: true,
            },
          },
        },
      }),

      prisma.sale.aggregate({
        where: {
          tenantId,
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        _sum: { total: true },
      }),

      prisma.sale.aggregate({
        where: {
          tenantId,
          createdAt: { gte: monthStart, lte: now },
        },
        _sum: { total: true },
      }),

      prisma.product.count({
        where: { tenantId, isActive: true },
      }),

      prisma.product.count({
        where: {
          tenantId,
          isActive: true,
          stockQty: { gt: 0, lte: threshold },
        },
      }),

      prisma.product.count({
        where: {
          tenantId,
          isActive: true,
          stockQty: 0,
        },
      }),

      prisma.product.findMany({
        where: {
          tenantId,
          isActive: true,
          stockQty: { lte: threshold },
        },
        orderBy: [{ stockQty: "asc" }, { name: "asc" }],
        take: 10,
        select: {
          id: true,
          name: true,
          stockQty: true,
          category: true,
          subcategory: true,
          subcategoryOther: true,
        },
      }),

      prisma.repair.count({
        where: {
          tenantId,
          status: { in: ["RECEIVED", "IN_PROGRESS"] },
        },
      }),

      prisma.interStoreDeal.count({
        where: {
          borrowerTenantId: tenantId,
          status: { in: ["BORROWED", "SOLD"] },
        },
      }),

      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          action: true,
          entity: true,
          createdAt: true,
        },
      }),
    ]);

    return res.json({
      threshold,

      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            district: tenant.district,
            sector: tenant.sector,
            shopType: tenant.shopType,
            logoUrl: tenant.logoUrl,
          }
        : null,

      subscriptionSummary: formatSubscriptionState(tenant?.subscription || null),

      todaySales: money(todaySalesAgg?._sum?.total),
      monthlyRevenue: money(monthSalesAgg?._sum?.total),

      productCount,
      lowStockCount,
      outOfStockCount,
      lowStockProducts,

      activeRepairs,
      pendingDeals,

      recentAudit,
    });
  } catch (err) {
    console.error("getTenantDashboard error:", err);
    return res.status(500).json({ message: "Failed to load dashboard" });
  }
}

module.exports = { getTenantDashboard };