// src/modules/expenses/expenses.controller.js
const prisma = require("../../config/database");
const logAudit = require("../../utils/auditLogger");
const { AuditAction, AuditEntity, ExpenseCategory } = require("@prisma/client");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function getActiveStoreLocationId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllStoreLocations(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function allowedStoreLocationIds(req) {
  return Array.isArray(req.user?.allowedBranchIds) ? req.user.allowedBranchIds : [];
}

function toMoneyNumber(value) {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function cleanString(value) {
  const s = value == null ? "" : String(value).trim();
  return s || null;
}

function normalizeExpenseCategory(input) {
  const raw = input == null ? "" : String(input).trim().toUpperCase();
  if (!raw) return null;
  return Object.values(ExpenseCategory).includes(raw) ? raw : null;
}

function makeAccessError(code, message, status = 403) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function resolveExpenseStoreLocationScope(req) {
  const requestedStoreLocationId =
    cleanString(req.query?.branchId) ||
    cleanString(req.headers["x-branch-id"]) ||
    null;

  const allStoreLocationsRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const allowedIds = allowedStoreLocationIds(req);

  if (allStoreLocationsRequested) {
    if (!canViewAllStoreLocations(req)) {
      throw makeAccessError(
        "STORE_LOCATION_ACCESS_DENIED",
        "You do not have access to view all store locations."
      );
    }

    return {
      mode: "ALL_STORE_LOCATIONS",
      branchId: null,
      storeLocationId: null,
      allowedStoreLocationIds: allowedIds,
    };
  }

  if (requestedStoreLocationId) {
    if (
      !canViewAllStoreLocations(req) &&
      allowedIds.length > 0 &&
      !allowedIds.includes(requestedStoreLocationId)
    ) {
      throw makeAccessError(
        "STORE_LOCATION_ACCESS_DENIED",
        "You do not have access to this store location."
      );
    }

    return {
      mode: "SINGLE_STORE_LOCATION",
      branchId: requestedStoreLocationId,
      storeLocationId: requestedStoreLocationId,
      allowedStoreLocationIds: allowedIds,
    };
  }

  const activeStoreLocationId = getActiveStoreLocationId(req);

  return {
    mode: "SINGLE_STORE_LOCATION",
    branchId: activeStoreLocationId,
    storeLocationId: activeStoreLocationId,
    allowedStoreLocationIds: allowedIds,
  };
}

function applyExpenseStoreLocationScope(where, scope) {
  const next = { ...(where || {}) };

  if (scope?.mode === "SINGLE_STORE_LOCATION" && scope?.branchId) {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableStoreLocationAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const storeLocationId = getActiveStoreLocationId(req);

  if (!tenantId) {
    throw makeAccessError("UNAUTHORIZED", "Unauthorized", 401);
  }

  if (!storeLocationId) {
    throw makeAccessError(
      "STORE_LOCATION_REQUIRED",
      "No active store location selected.",
      400
    );
  }

  const allowedIds = allowedStoreLocationIds(req);

  if (
    !canViewAllStoreLocations(req) &&
    allowedIds.length > 0 &&
    !allowedIds.includes(storeLocationId)
  ) {
    throw makeAccessError(
      "STORE_LOCATION_ACCESS_DENIED",
      "You do not have access to this store location."
    );
  }

  const storeLocation = await prisma.branch.findFirst({
    where: {
      id: storeLocationId,
      tenantId,
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
    },
  });

  if (!storeLocation) {
    throw makeAccessError(
      "STORE_LOCATION_NOT_FOUND",
      "Store location not found.",
      404
    );
  }

  if (storeLocation.status !== "ACTIVE") {
    throw makeAccessError(
      "STORE_LOCATION_NOT_ACTIVE",
      "Selected store location is not active.",
      409
    );
  }

  return storeLocation;
}

function expenseInclude() {
  return {
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
  };
}

function storeLocationScopeForClient(scope) {
  if (!scope) return null;

  return {
    mode: scope.mode,
    storeLocationId: scope.storeLocationId || null,
    allowedStoreLocationIds: scope.allowedStoreLocationIds || [],
  };
}

function handleStoreLocationError(res, error, fallbackMessage) {
  const code = String(error?.code || "");

  if (
    code === "UNAUTHORIZED" ||
    code === "STORE_LOCATION_REQUIRED" ||
    code === "STORE_LOCATION_ACCESS_DENIED" ||
    code === "STORE_LOCATION_NOT_FOUND" ||
    code === "STORE_LOCATION_NOT_ACTIVE"
  ) {
    return res.status(error.status || 500).json({
      message: error.message,
      code,
    });
  }

  return res.status(error?.status || 500).json({
    message: error?.message || fallbackMessage,
    code: error?.code || null,
  });
}

// CREATE EXPENSE
async function createExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);

  const { title, category, amount, notes } = req.body || {};

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  const cleanTitle = cleanString(title);
  if (!cleanTitle) {
    return res.status(400).json({
      message: "Expense title is required.",
      code: "EXPENSE_TITLE_REQUIRED",
    });
  }

  const cleanCategory = normalizeExpenseCategory(category);
  if (!cleanCategory) {
    return res.status(400).json({
      message: `Expense category must be one of ${Object.values(ExpenseCategory).join(", ")}.`,
      code: "EXPENSE_CATEGORY_INVALID",
    });
  }

  const cleanAmount = toMoneyNumber(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return res.status(400).json({
      message: "Expense amount must be a positive number.",
      code: "EXPENSE_AMOUNT_INVALID",
    });
  }

  const cleanNotes = cleanString(notes);

  try {
    const storeLocation = await ensureWritableStoreLocationAccessOrThrow(req);

    const expense = await prisma.expense.create({
      data: {
        title: cleanTitle,
        category: cleanCategory,
        amount: cleanAmount,
        notes: cleanNotes,
        status: "PENDING",
        tenantId,
        branchId: storeLocation.id,
        createdById: userId,
      },
      include: expenseInclude(),
    });

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_CREATED,
      entity: AuditEntity.EXPENSE,
      entityId: expense.id,
      metadata: {
        title: cleanTitle,
        category: cleanCategory,
        amount: cleanAmount,
        storeLocationId: storeLocation.id,
        branchId: storeLocation.id,
      },
    });

    return res.status(201).json(expense);
  } catch (error) {
    console.error("createExpense error:", error);
    return handleStoreLocationError(res, error, "Failed to create expense");
  }
}

// LIST EXPENSES
async function listExpenses(req, res) {
  const tenantId = getTenantId(req);

  if (!tenantId) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  try {
    const scope = resolveExpenseStoreLocationScope(req);

    const expenses = await prisma.expense.findMany({
      where: applyExpenseStoreLocationScope({ tenantId }, scope),
      orderBy: { createdAt: "desc" },
      include: expenseInclude(),
      take: 200,
    });

    return res.json({
      expenses,
      count: expenses.length,
      storeLocationScope: storeLocationScopeForClient(scope),

      // Kept temporarily for older frontend code that still reads branchScope.
      branchScope: {
        mode:
          scope.mode === "ALL_STORE_LOCATIONS"
            ? "ALL_BRANCHES"
            : "SINGLE_BRANCH",
        branchId: scope.branchId || null,
        allowedBranchIds: scope.allowedStoreLocationIds || [],
      },
    });
  } catch (error) {
    console.error("listExpenses error:", error);
    return handleStoreLocationError(res, error, "Failed to fetch expenses");
  }
}

// APPROVE EXPENSE
async function approveExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  try {
    const scope = resolveExpenseStoreLocationScope(req);

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
      return res.status(404).json({
        message: "Expense not found.",
        code: "EXPENSE_NOT_FOUND",
      });
    }

    if (
      scope.mode === "SINGLE_STORE_LOCATION" &&
      scope.branchId &&
      existing.branchId !== scope.branchId
    ) {
      return res.status(403).json({
        message: "You do not have access to this store location.",
        code: "STORE_LOCATION_ACCESS_DENIED",
      });
    }

    if (existing.status === "APPROVED") {
      const approved = await prisma.expense.findFirst({
        where: { id, tenantId },
        include: expenseInclude(),
      });

      return res.json(approved);
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
      return res.status(404).json({
        message: "Expense not found or already approved.",
        code: "EXPENSE_NOT_FOUND_OR_ALREADY_APPROVED",
      });
    }

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_APPROVED,
      entity: AuditEntity.EXPENSE,
      entityId: id,
      metadata: {
        storeLocationId: existing.branchId || null,
        branchId: existing.branchId || null,
      },
    });

    const updated = await prisma.expense.findFirst({
      where: { id, tenantId },
      include: expenseInclude(),
    });

    return res.json(updated);
  } catch (error) {
    console.error("approveExpense error:", error);
    return handleStoreLocationError(res, error, "Failed to approve expense");
  }
}

// DELETE EXPENSE
async function deleteExpense(req, res) {
  const tenantId = getTenantId(req);
  const userId = getUserId(req);
  const { id } = req.params;

  if (!tenantId || !userId) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  try {
    const scope = resolveExpenseStoreLocationScope(req);

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
      return res.status(404).json({
        message: "Expense not found.",
        code: "EXPENSE_NOT_FOUND",
      });
    }

    if (
      scope.mode === "SINGLE_STORE_LOCATION" &&
      scope.branchId &&
      existing.branchId !== scope.branchId
    ) {
      return res.status(403).json({
        message: "You do not have access to this store location.",
        code: "STORE_LOCATION_ACCESS_DENIED",
      });
    }

    if (existing.status === "APPROVED") {
      return res.status(409).json({
        message: "Approved expenses cannot be deleted because they are financial records.",
        code: "APPROVED_EXPENSE_CANNOT_BE_DELETED",
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
        message: "Expense not found or cannot be deleted.",
        code: "EXPENSE_NOT_FOUND_OR_NOT_DELETABLE",
      });
    }

    await logAudit({
      tenantId,
      userId,
      action: AuditAction.EXPENSE_DELETED,
      entity: AuditEntity.EXPENSE,
      entityId: id,
      metadata: {
        storeLocationId: existing.branchId || null,
        branchId: existing.branchId || null,
      },
    });

    return res.json({
      message: "Expense deleted successfully.",
      code: "EXPENSE_DELETED",
    });
  } catch (error) {
    console.error("deleteExpense error:", error);
    return handleStoreLocationError(res, error, "Failed to delete expense");
  }
}

module.exports = {
  createExpense,
  listExpenses,
  approveExpense,
  deleteExpense,
};