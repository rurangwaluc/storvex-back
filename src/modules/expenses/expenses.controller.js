const prisma = require("../../config/database");
const logAudit = require("../../utils/auditLogger");
const { AuditAction, AuditEntity, ExpenseCategory } = require("@prisma/client");

function getTenantId(req) {
  return req.user?.tenantId || null;
}
function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function toMoneyNumber(x) {
  const n = typeof x === "string" ? Number(x.trim()) : Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeExpenseCategory(input) {
  const raw = input == null ? "" : String(input).trim().toUpperCase();
  if (!raw) return null;
  return Object.values(ExpenseCategory).includes(raw) ? raw : null;
}

// CREATE EXPENSE
async function createExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  const { title, category, amount, notes } = req.body;

  if (!tenantId || !userId) return res.status(401).json({ message: "Unauthorized" });

  const t = title == null ? "" : String(title).trim();
  if (!t) return res.status(400).json({ message: "title is required" });

  const cat = normalizeExpenseCategory(category);
  if (!cat) {
    return res.status(400).json({
      message: `category must be one of ${Object.values(ExpenseCategory).join(", ")}`,
    });
  }

  const amt = toMoneyNumber(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ message: "amount must be a positive number" });
  }

  const cleanNotes = notes == null ? null : String(notes).trim() || null;

  try {
    const expense = await prisma.expense.create({
      data: {
        title: t,
        category: cat,
        amount: amt,
        notes: cleanNotes,
        status: "PENDING",
        tenantId,
        createdById: userId,
      },
    });

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_CREATED,
      entity: AuditEntity.EXPENSE,
      entityId: expense.id,
      metadata: { title: t, category: cat, amount: amt },
    });

    return res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to create expense" });
  }
}

// LIST EXPENSES
async function listExpenses(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const expenses = await prisma.expense.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      take: 200,
    });

    return res.json({ expenses, count: expenses.length });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to fetch expenses" });
  }
}

// APPROVE EXPENSE (tenant-safe)
async function approveExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    // ✅ tenant-safe + idempotent
    const result = await prisma.expense.updateMany({
      where: { id, tenantId, status: { not: "APPROVED" } },
      data: { status: "APPROVED", approvedById: userId, approvedAt: new Date() },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Expense not found or already approved" });
    }

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_APPROVED,
      entity: AuditEntity.EXPENSE,
      entityId: id,
    });

    const updated = await prisma.expense.findFirst({ where: { id, tenantId } });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to approve expense" });
  }
}

// DELETE EXPENSE (tenant-safe)
async function deleteExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    // ✅ tenant-safe + prevents deleting approved
    const result = await prisma.expense.deleteMany({
      where: { id, tenantId, status: { not: "APPROVED" } },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: "Expense not found or cannot delete (approved)" });
    }

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_DELETED,
      entity: AuditEntity.EXPENSE,
      entityId: id,
    });

    return res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to delete expense" });
  }
}

module.exports = { createExpense, listExpenses, approveExpense, deleteExpense };
