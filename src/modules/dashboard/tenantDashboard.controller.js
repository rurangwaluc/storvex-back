const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function tenantDashboard(req, res) {
  try {
    if (!req.user || !req.user.tenantId) {
      return res.status(401).json({ message: "Unauthorized: no tenantId" });
    }

    const tenantId = req.user.tenantId;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(
      todayStart.getFullYear(),
      todayStart.getMonth(),
      1
    );

    const [
      todaySales,
      monthlyRevenue,
      productCount,
      lowStockCount,
      lowStockProducts,
      activeRepairs,
      pendingDeals,
      recentAudit
    ] = await Promise.all([
      prisma.sale.aggregate({
        where: { tenantId, createdAt: { gte: todayStart } },
        _sum: { total: true }
      }).catch(() => ({ _sum: { total: 0 } })),

      prisma.sale.aggregate({
        where: { tenantId, createdAt: { gte: monthStart } },
        _sum: { total: true }
      }).catch(() => ({ _sum: { total: 0 } })),

      prisma.product.count({
        where: { tenantId, isActive: true }
      }).catch(() => 0),

      prisma.product.count({
        where: { tenantId, stockQty: { lte: 5 }, isActive: true }
      }).catch(() => 0),

      prisma.product.findMany({
        where: { tenantId, stockQty: { lte: 5 }, isActive: true },
        take: 5
      }).catch(() => []),

      prisma.repair.count({
        where: {
          tenantId,
          status: { in: ["RECEIVED", "IN_PROGRESS"] }
        }
      }).catch(() => 0),

      prisma.interStoreDeal.count({
        where: {
          borrowerTenantId: tenantId,
          status: { in: ["BORROWED", "RECEIVED"] }
        }
      }).catch(() => 0),

      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 6
      }).catch(() => [])
    ]);

    res.json({
      todaySales: todaySales._sum.total || 0,
      monthlyRevenue: monthlyRevenue._sum.total || 0,
      productCount,
      lowStockCount,
      lowStockProducts,
      activeRepairs,
      pendingDeals,
      recentAudit
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({
      message: "Failed to load dashboard",
      error: err.message
    });
  }
}

module.exports = { tenantDashboard };
