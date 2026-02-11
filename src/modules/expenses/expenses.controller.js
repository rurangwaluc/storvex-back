const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// CREATE EXPENSE
async function createExpense(req, res) {
  const { title, category, amount, notes } = req.body;

  if (!title || !category || !amount) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const expense = await prisma.expense.create({
      data: {
        title,
        category,
        amount,
        notes,
        status: "PENDING", // important for approval flow

        tenant: {
          connect: { id: req.user.tenantId },
        },
        createdBy: {
          connect: { id: req.user.id },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        action: "EXPENSE_CREATED",
        entity: "EXPENSE",
        entityId: expense.id,
        metadata: { title, category, amount },
      },
    });

    res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create expense" });
  }
}

// LIST EXPENSES
async function listExpenses(req, res) {
  try {
    const expenses = await prisma.expense.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { name: true } },
      },
    });

    res.json(expenses);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch expenses" });
  }
}

// ✅ APPROVE EXPENSE
async function approveExpense(req, res) {
  const { id } = req.params;

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        id,
        tenantId: req.user.tenantId,
      },
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (expense.status === "APPROVED") {
      return res.status(400).json({ message: "Expense already approved" });
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        action: "EXPENSE_APPROVED",
        entity: "EXPENSE",
        entityId: id,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to approve expense" });
  }
}

// ❌ DELETE EXPENSE
async function deleteExpense(req, res) {
  const { id } = req.params;

  try {
    const expense = await prisma.expense.findFirst({
      where: {
        id,
        tenantId: req.user.tenantId,
      },
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found" });
    }

    if (expense.status === "APPROVED") {
      return res
        .status(400)
        .json({ message: "Approved expenses cannot be deleted" });
    }

    await prisma.expense.delete({
      where: { id },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        action: "EXPENSE_DELETED",
        entity: "EXPENSE",
        entityId: id,
      },
    });

    res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete expense" });
  }
}

module.exports = {
  createExpense,
  listExpenses,
  approveExpense,
  deleteExpense,
};
