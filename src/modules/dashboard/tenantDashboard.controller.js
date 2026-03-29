// src/modules/dashboard/tenantDashboard.controller.js
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

/**
 * GET /api/dashboard
 * Returns numbers the dashboard needs, including low stock alerts.
 */
async function getTenantDashboard(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const monthStart = startOfMonth(now);

    // Low stock threshold (simple default)
    const thresholdRaw = Number(process.env.LOW_STOCK_THRESHOLD || 5);
    const threshold =
      Number.isFinite(thresholdRaw) && thresholdRaw >= 1 && thresholdRaw <= 9999
        ? Math.floor(thresholdRaw)
        : 5;

    const [
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
      prisma.sale.aggregate({
        where: { tenantId, createdAt: { gte: todayStart, lte: todayEnd } },
        _sum: { total: true },
      }),

      prisma.sale.aggregate({
        where: { tenantId, createdAt: { gte: monthStart, lte: now } },
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
        select: { id: true, action: true, entity: true, createdAt: true },
      }),
    ]);

    return res.json({
      threshold,

      todaySales: money(todaySalesAgg._sum.total),
      monthlyRevenue: money(monthSalesAgg._sum.total),

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