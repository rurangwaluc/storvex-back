const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ---------------------
// SALES SUMMARY
// ---------------------
async function salesSummary(req, res) {
  try {
    // 1. Aggregating total sales
    const sales = await prisma.sale.aggregate({
      where: {
        tenantId: req.user.tenantId,
      },
      _sum: {
        total: true,
      },
      _count: {
        id: true,
      },
    });

    // 2. Aggregating total expenses
    const totalExpenses = await prisma.expense.aggregate({
      where: {
        tenantId: req.user.tenantId,
      },
      _sum: { amount: true },
    });

    // 3. Calculate profit
    const totalSales = sales._sum.total || 0;
    const totalExpensesAmount = totalExpenses._sum.amount || 0;
    const profit = totalSales - totalExpensesAmount;

    // 4. Return the final response
    return res.json({
      totalSalesCount: sales._count.id || 0,
      totalRevenue: totalSales,
      totalExpenses: totalExpensesAmount,
      profit: profit,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to generate sales report" });
  }
}

// ---------------------
// INVENTORY REPORT
// ---------------------
async function inventoryReport(req, res) {
  try {
    const products = await prisma.product.findMany({
      where: {
        tenantId: req.user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        stockQty: true,
        sellPrice: true,
      },
    });

    return res.json(products);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Failed to generate inventory report" });
  }
}

// ---------------------
// REPAIRS REPORT
// ---------------------
async function repairsReport(req, res) {
  try {
    const repairs = await prisma.repair.groupBy({
      by: ["status"],
      where: {
        tenantId: req.user.tenantId,
      },
      _count: {
        id: true,
      },
    });

    return res.json(repairs);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Failed to generate repairs report" });
  }
}

module.exports = {
  salesSummary,
  inventoryReport,
  repairsReport,
};
