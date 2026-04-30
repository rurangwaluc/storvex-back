const prisma = require("../../config/database");
const { getGraceDays } = require("../../config/plans");
const { resolveSubscriptionAccess } = require("../billing/subscriptionAccess");
const { buildTrialBanner, getSetupChecklist } = require("../store/store.service");

const ACCESSIBLE_BRANCH_STATUSES = ["ACTIVE", "CLOSED"];

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function isOwner(role) {
  return normalizeRole(role) === "OWNER";
}

function fieldExists(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

/**
 * Normalize backend subscription state into a stable frontend contract.
 *
 * Frontend modes:
 * - TRIAL     => active trial account
 * - ACTIVE    => active paid account
 * - READ_ONLY => grace / restricted / expired read-only bucket
 *
 * Frontend should use:
 * - status for blocking truth
 * - accessMode for UI mode
 */
function normalizeFrontendSubscriptionMode(subscription, resolved) {
  const status = String(subscription?.status || "").toUpperCase();
  const storedAccessMode = String(subscription?.accessMode || "").toUpperCase();
  const resolvedMode = String(resolved?.mode || "").toUpperCase();

  const trialEndDate = toValidDate(subscription?.trialEndDate);
  const endDate = toValidDate(subscription?.endDate);
  const graceEndDate = toValidDate(resolved?.graceEndDate || subscription?.graceEndDate);
  const now = new Date();

  const isExpired = status === "EXPIRED" || resolved?.canOperate === false;

  if (isExpired) {
    return "READ_ONLY";
  }

  const isTrial = Boolean(
    trialEndDate &&
      trialEndDate >= now &&
      storedAccessMode === "TRIAL",
  );

  if (isTrial) {
    return "TRIAL";
  }

  const isGrace = Boolean(
    endDate &&
      endDate < now &&
      graceEndDate &&
      graceEndDate >= now,
  );

  if (isGrace) {
    return "READ_ONLY";
  }

  if (resolvedMode === "READ_ONLY") {
    return "READ_ONLY";
  }

  if (resolvedMode === "TRIAL") {
    return "TRIAL";
  }

  return "ACTIVE";
}

function normalizeBranch(branch) {
  if (!branch) return null;

  return {
    id: branch.id,
    tenantId: branch.tenantId,
    name: branch.name,
    code: branch.code,
    type: branch.type,
    status: branch.status,
    phone: branch.phone || null,
    email: branch.email || null,
    countryCode: branch.countryCode || "RW",
    district: branch.district || null,
    sector: branch.sector || null,
    address: branch.address || null,
    isMain: Boolean(branch.isMain),
    createdAt: branch.createdAt || null,
    updatedAt: branch.updatedAt || null,
  };
}

function normalizeAssignedBranch(row) {
  if (!row?.branch) return null;

  return {
    assignmentId: row.id,
    isDefault: Boolean(row.isDefault),
    canOperate: Boolean(row.canOperate),
    canViewReports: Boolean(row.canViewReports),
    assignedAt: row.createdAt || null,
    ...normalizeBranch(row.branch),
  };
}

function normalizeOwnerVisibleBranch(branch, assignmentByBranchId) {
  if (!branch?.id) return null;

  const assignment = assignmentByBranchId.get(branch.id) || null;

  return {
    assignmentId: assignment?.id || null,
    isDefault: Boolean(assignment?.isDefault || branch.isMain),
    canOperate: assignment ? Boolean(assignment.canOperate) : branch.status === "ACTIVE",
    canViewReports: assignment ? Boolean(assignment.canViewReports) : true,
    assignedAt: assignment?.createdAt || null,
    ...normalizeBranch(branch),
  };
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function toOptionalPositiveInteger(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;

  return Math.floor(n);
}

function toNonNegativeInteger(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;

  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return fallback;

  return Math.floor(n);
}

function computeBranchEntitlement(subscription, activeBranchesCount) {
  const includedBranchLimit = toOptionalPositiveInteger(subscription?.branchLimit);
  const extraBranchCount = toNonNegativeInteger(subscription?.extraBranchCount, 0);
  const activeBranches = toNonNegativeInteger(activeBranchesCount, 0);

  /*
    Rule:
    - null branchLimit means unlimited / not enforced yet.
    - positive branchLimit means enforce included + extra.
    - 0 is treated as "not configured", not as a valid zero-branch plan.
    - CLOSED branches can be visible, but do not count as active branch usage.
  */
  const effectiveBranchLimit =
    includedBranchLimit == null ? null : includedBranchLimit + extraBranchCount;

  const overLimit =
    effectiveBranchLimit == null ? false : activeBranches > effectiveBranchLimit;

  const atLimit =
    effectiveBranchLimit == null ? false : activeBranches >= effectiveBranchLimit;

  const canAddBranch =
    effectiveBranchLimit == null ? true : activeBranches < effectiveBranchLimit;

  return {
    activeBranches,
    includedBranchLimit,
    extraBranchCount,
    effectiveBranchLimit,
    overLimit,
    atLimit,
    canAddBranch,
  };
}

function tenantSelect() {
  return {
    id: true,
    name: true,
    status: true,
    phone: true,

    ...(fieldExists(prisma.tenant, "email") ? { email: true } : {}),
    ...(fieldExists(prisma.tenant, "shopType") ? { shopType: true } : {}),
    ...(fieldExists(prisma.tenant, "district") ? { district: true } : {}),
    ...(fieldExists(prisma.tenant, "sector") ? { sector: true } : {}),
    ...(fieldExists(prisma.tenant, "address") ? { address: true } : {}),
    ...(fieldExists(prisma.tenant, "logoUrl") ? { logoUrl: true } : {}),
    ...(fieldExists(prisma.tenant, "logoKey") ? { logoKey: true } : {}),
    ...(fieldExists(prisma.tenant, "receiptHeader") ? { receiptHeader: true } : {}),
    ...(fieldExists(prisma.tenant, "receiptFooter") ? { receiptFooter: true } : {}),
    ...(fieldExists(prisma.tenant, "onboardingCompleted") ? { onboardingCompleted: true } : {}),
    ...(fieldExists(prisma.tenant, "onboardingCompletedAt") ? { onboardingCompletedAt: true } : {}),
    ...(fieldExists(prisma.tenant, "cash_drawer_block_cash_sales")
      ? { cash_drawer_block_cash_sales: true }
      : {}),
    ...(fieldExists(prisma.tenant, "mainBranchId") ? { mainBranchId: true } : {}),
    ...(fieldExists(prisma.tenant, "countryCode") ? { countryCode: true } : {}),
    ...(fieldExists(prisma.tenant, "currencyCode") ? { currencyCode: true } : {}),
    ...(fieldExists(prisma.tenant, "timezone") ? { timezone: true } : {}),

    mainBranch: {
      select: branchSelect(),
    },
  };
}

function branchSelect() {
  return {
    id: true,
    tenantId: true,
    name: true,
    code: true,
    type: true,
    status: true,
    phone: true,
    email: true,
    countryCode: true,
    district: true,
    sector: true,
    address: true,
    isMain: true,
    createdAt: true,
    updatedAt: true,
  };
}

function activeBranchPermissions(activeBranch, reqUser) {
  return {
    canOperateInActiveBranch:
      typeof activeBranch?.canOperate === "boolean"
        ? activeBranch.canOperate
        : Boolean(reqUser?.canOperateInActiveBranch),

    canViewReportsInActiveBranch:
      typeof activeBranch?.canViewReports === "boolean"
        ? activeBranch.canViewReports
        : Boolean(reqUser?.canViewReportsInActiveBranch),
  };
}

async function me(req, res) {
  try {
    const userId = req.user?.userId || req.user?.id;
    const tenantId = req.user?.tenantId;

    if (!userId || !tenantId) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "AUTH_REQUIRED",
      });
    }

    const activeBranchIdFromAuth = req.user?.activeBranchId || req.user?.branchId || null;
    const defaultBranchIdFromAuth = req.user?.defaultBranchId || null;
    const allowedBranchIdsFromAuth = uniqueStrings(req.user?.allowedBranchIds || []);

    const [
      user,
      tenant,
      subscription,
      userBranchAssignments,
      activeBranchesCount,
    ] = await Promise.all([
      prisma.user.findFirst({
        where: {
          id: userId,
          tenantId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          tenantId: true,
          isActive: true,
        },
      }),

      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: tenantSelect(),
      }),

      prisma.subscription.findUnique({
        where: { tenantId },
        select: {
          id: true,
          status: true,
          accessMode: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          startDate: true,
          endDate: true,
          trialStartDate: true,
          trialEndDate: true,
          graceEndDate: true,
          readOnlySince: true,
          lastPaymentAt: true,
          renewedAt: true,
          branchLimit: true,
          extraBranchCount: true,
        },
      }),

      prisma.userBranchAssignment.findMany({
        where: {
          tenantId,
          userId,
          branch: {
            tenantId,
            status: {
              in: ACCESSIBLE_BRANCH_STATUSES,
            },
          },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isDefault: true,
          canOperate: true,
          canViewReports: true,
          createdAt: true,
          branchId: true,
          branch: {
            select: branchSelect(),
          },
        },
      }),

      prisma.branch.count({
        where: {
          tenantId,
          status: "ACTIVE",
        },
      }),
    ]);

    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "AUTH_USER_INVALID",
      });
    }

    if (!tenant) {
      return res.status(401).json({
        message: "Tenant not found",
        code: "AUTH_TENANT_NOT_FOUND",
      });
    }

    const role = normalizeRole(user.role);

    /*
      OWNER can view all active/closed branches.
      Other roles see only assigned branches.
    */
    const canViewAllBranches = isOwner(role) || Boolean(req.user?.canViewAllBranches);

    const allVisibleBranchesForOwner = canViewAllBranches
      ? await prisma.branch.findMany({
          where: {
            tenantId,
            status: {
              in: ACCESSIBLE_BRANCH_STATUSES,
            },
          },
          orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
          select: branchSelect(),
        })
      : [];

    const resolved = resolveSubscriptionAccess({
      tenantStatus: tenant?.status,
      subscription,
      graceDays: getGraceDays(),
      now: new Date(),
    });

    const frontendAccessMode = normalizeFrontendSubscriptionMode(subscription, resolved);

    const setupChecklist = tenant
      ? await getSetupChecklist(tenantId, {
          accessMode: frontendAccessMode,
          status: subscription?.status || null,
          endDate: subscription?.endDate || null,
          trialEndDate: subscription?.trialEndDate || null,
          graceEndDate: resolved.graceEndDate || subscription?.graceEndDate || null,
        })
      : null;

    const assignmentByBranchId = new Map(
      (userBranchAssignments || [])
        .filter((row) => row?.branchId)
        .map((row) => [row.branchId, row]),
    );

    const assignedBranches = (userBranchAssignments || [])
      .map(normalizeAssignedBranch)
      .filter(Boolean);

    const ownerVisibleBranches = canViewAllBranches
      ? (allVisibleBranchesForOwner || [])
          .map((branch) => normalizeOwnerVisibleBranch(branch, assignmentByBranchId))
          .filter(Boolean)
      : [];

    const branches = canViewAllBranches ? ownerVisibleBranches : assignedBranches;

    const mainBranch = normalizeBranch(tenant?.mainBranch) || null;

    const activeBranch =
      branches.find((branch) => branch.id === activeBranchIdFromAuth) ||
      normalizeBranch(req.branch) ||
      branches.find((branch) => branch.id === defaultBranchIdFromAuth) ||
      branches.find((branch) => branch.isDefault) ||
      branches.find((branch) => branch.isMain) ||
      branches[0] ||
      mainBranch ||
      null;

    const defaultBranch =
      branches.find((branch) => branch.id === defaultBranchIdFromAuth) ||
      branches.find((branch) => branch.isDefault) ||
      branches.find((branch) => branch.isMain) ||
      branches[0] ||
      mainBranch ||
      null;

    const visibleBranchIds = uniqueStrings(branches.map((branch) => branch.id));

    const allowedBranchIds = canViewAllBranches
      ? visibleBranchIds
      : uniqueStrings(
          allowedBranchIdsFromAuth.length
            ? allowedBranchIdsFromAuth
            : assignedBranches.map((branch) => branch.id),
        );

    const branchUsage = computeBranchEntitlement(subscription, activeBranchesCount);
    const activePermissions = activeBranchPermissions(activeBranch, req.user);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        role: user.role,
        tenantId: user.tenantId,

        defaultBranchId: defaultBranch?.id || null,
        activeBranchId: activeBranch?.id || null,
        branchId: activeBranch?.id || null,

        allowedBranchIds,
        visibleBranchIds,
        canViewAllBranches,
        canOperateInActiveBranch: activePermissions.canOperateInActiveBranch,
        canViewReportsInActiveBranch: activePermissions.canViewReportsInActiveBranch,
      },

      tenant: {
        ...tenant,
        email: tenant.email || null,
        logoUrl: tenant.logoUrl || null,
        logoKey: tenant.logoKey || null,
        countryCode: tenant.countryCode || "RW",
        currencyCode: tenant.currencyCode || "RWF",
        timezone: tenant.timezone || "Africa/Kigali",
        cashDrawerBlockCashSales: Boolean(tenant.cash_drawer_block_cash_sales),
        mainBranch,
      },

      branches,
      defaultBranch,
      activeBranch,
      mainBranch,

      branchAccess: {
        requestedBranchId: req.branchAccess?.requestedBranchId || null,
        defaultBranchId: defaultBranch?.id || null,
        activeBranchId: activeBranch?.id || null,
        allowedBranchIds,
        visibleBranchIds,
        canViewAllBranches,
        canOperateInActiveBranch: activePermissions.canOperateInActiveBranch,
        canViewReportsInActiveBranch: activePermissions.canViewReportsInActiveBranch,
      },

      branchUsage,

      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            storedAccessMode: subscription.accessMode,
            accessMode: frontendAccessMode,
            planKey: subscription.planKey,
            tierKey: subscription.tierKey || null,
            cycleKey: subscription.cycleKey || null,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            trialStartDate: subscription.trialStartDate,
            trialEndDate: subscription.trialEndDate,
            graceEndDate: resolved.graceEndDate || subscription.graceEndDate,
            readOnlySince: subscription.readOnlySince,
            lastPaymentAt: subscription.lastPaymentAt,
            renewedAt: subscription.renewedAt,
            branchLimit: subscription.branchLimit,
            extraBranchCount: subscription.extraBranchCount ?? 0,
            effectiveBranchLimit: branchUsage.effectiveBranchLimit,
            activeBranches: branchUsage.activeBranches,
            canAddBranch: branchUsage.canAddBranch,
            overBranchLimit: branchUsage.overLimit,
            atBranchLimit: branchUsage.atLimit,
            canRead: resolved.canRead,
            canOperate: resolved.canOperate,
            daysLeft: resolved.daysLeft,
            reason: resolved.reason,
          }
        : null,

      trialBanner: buildTrialBanner({
        accessMode: frontendAccessMode,
        status: subscription?.status || null,
        endDate: subscription?.endDate || null,
        trialEndDate: subscription?.trialEndDate || null,
        graceEndDate: resolved.graceEndDate || subscription?.graceEndDate || null,
      }),

      setupChecklistSummary: setupChecklist
        ? {
            isOperationallyReady: setupChecklist.isOperationallyReady,
            onboardingCompleted: setupChecklist.onboardingCompleted,
            onboardingCompletedAt: setupChecklist.onboardingCompletedAt,
            readinessPercent: setupChecklist.readinessPercent,
            counts: setupChecklist.counts,
            summary: setupChecklist.summary,
          }
        : null,
    });
  } catch (err) {
    console.error("me error:", err);

    return res.status(500).json({
      message: "Server error",
      code: "ME_FAILED",
    });
  }
}

module.exports = { me };