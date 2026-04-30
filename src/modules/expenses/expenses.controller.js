const prisma = require("../../config/database");
const logAudit = require("../../utils/auditLogger");
const { AuditAction, AuditEntity, ExpenseCategory } = require("@prisma/client");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function getBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function toMoneyNumber(x) {
  const n = typeof x === "string" ? Number(x.trim()) : Number(x);
  return Number.isFinite(n) ? n : NaN;
}

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function normalizeExpenseCategory(input) {
  const raw = input == null ? "" : String(input).trim().toUpperCase();
  if (!raw) return null;
  return Object.values(ExpenseCategory).includes(raw) ? raw : null;
}

function resolveExpenseBranchScope(req) {
  const branchIdFromQuery = cleanString(req.query?.branchId);
  const allBranchesRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  if (allBranchesRequested) {
    if (!canViewAllBranches(req)) {
      const err = new Error("Branch access denied");
      err.status = 403;
      err.code = "BRANCH_ACCESS_DENIED";
      throw err;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
    };
  }

  if (branchIdFromQuery) {
    if (!canViewAllBranches(req)) {
      const allowed = Array.isArray(req.user?.allowedBranchIds) ? req.user.allowedBranchIds : [];
      if (!allowed.includes(branchIdFromQuery)) {
        const err = new Error("Branch access denied");
        err.status = 403;
        err.code = "BRANCH_ACCESS_DENIED";
        throw err;
      }
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: branchIdFromQuery,
    };
  }

  return {
    mode: "SINGLE_BRANCH",
    branchId: getBranchId(req),
  };
}

// CREATE EXPENSE
async function createExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const branchId = getBranchId(req);

  const { title, category, amount, notes } = req.body;

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!branchId) {
    return res.status(400).json({
      message: "No active branch selected",
      code: "BRANCH_REQUIRED",
    });
  }

  const t = title == null ? "" : String(title).trim();
  if (!t) {
    return res.status(400).json({ message: "title is required" });
  }

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
        branchId,
        createdById: userId,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
      },
    });

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_CREATED,
      entity: AuditEntity.EXPENSE,
      entityId: expense.id,
      metadata: {
        title: t,
        category: cat,
        amount: amt,
        branchId,
      },
    });

    return res.status(201).json(expense);
  } catch (err) {
    console.error("createExpense error:", err);
    return res.status(500).json({ message: "Failed to create expense" });
  }
}

// LIST EXPENSES
async function listExpenses(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const scope = resolveExpenseBranchScope(req);

    const where = {
      tenantId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
    };

    const expenses = await prisma.expense.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
      },
      take: 200,
    });

    return res.json({
      expenses,
      count: expenses.length,
      branchScope: scope,
    });
  } catch (err) {
    console.error("listExpenses error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to fetch expenses",
      code: err.code || null,
    });
  }
}

// APPROVE EXPENSE (tenant-safe + branch-aware)
async function approveExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const existing = await prisma.expense.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const scope = resolveExpenseBranchScope(req);

    if (scope.mode === "SINGLE_BRANCH" && scope.branchId && existing.branchId !== scope.branchId) {
      return res.status(403).json({
        message: "Branch access denied",
        code: "BRANCH_ACCESS_DENIED",
      });
    }

    const result = await prisma.expense.updateMany({
      where: {
        id,
        tenantId,
        status: { not: "APPROVED" },
      },
      data: {
        status: "APPROVED",
        approvedById: userId,
        approvedAt: new Date(),
      },
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
      metadata: {
        branchId: existing.branchId || null,
      },
    });

    const updated = await prisma.expense.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            isMain: true,
          },
        },
      },
    });

    return res.json(updated);
  } catch (err) {
    console.error("approveExpense error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to approve expense",
      code: err.code || null,
    });
  }
}

// DELETE EXPENSE (tenant-safe + branch-aware)
async function deleteExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const existing = await prisma.expense.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Expense not found" });
    }

    const scope = resolveExpenseBranchScope(req);

    if (scope.mode === "SINGLE_BRANCH" && scope.branchId && existing.branchId !== scope.branchId) {
      return res.status(403).json({
        message: "Branch access denied",
        code: "BRANCH_ACCESS_DENIED",
      });
    }

    const result = await prisma.expense.deleteMany({
      where: {
        id,
        tenantId,
        status: { not: "APPROVED" },
      },
    });

    if (result.count === 0) {
      return res.status(404).json({
        message: "Expense not found or cannot delete (approved)",
      });
    }

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_DELETED,
      entity: AuditEntity.EXPENSE,
      entityId: id,
      metadata: {
        branchId: existing.branchId || null,
      },
    });

    return res.json({ message: "Expense deleted successfully" });
  } catch (err) {
    console.error("deleteExpense error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to delete expense",
      code: err.code || null,
    });
  }
}

module.exports = {
  createExpense,
  listExpenses,
  approveExpense,
  deleteExpense,
};