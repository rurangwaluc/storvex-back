const prisma = require("../../config/database");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeBranchCode(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return raw || null;
}

function normalizeBranchName(value) {
  const s = cleanString(value);
  return s || null;
}

function normalizeOptionalText(value) {
  const s = cleanString(value);
  return s || null;
}

function toPositiveIntOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function isOwnerOrManager(role) {
  const normalized = normalizeUpper(role);
  return normalized === "OWNER" || normalized === "MANAGER";
}

function formatBranch(branch) {
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
    createdById: branch.createdById || null,
    createdAt: branch.createdAt || null,
    updatedAt: branch.updatedAt || null,
  };
}

function computeBranchUsage(subscription, activeBranchesCount) {
  const includedBranchLimit = toPositiveIntOrNull(subscription?.branchLimit);
  const extraBranchCount = toPositiveIntOrNull(subscription?.extraBranchCount) ?? 0;
  const activeBranches = toPositiveIntOrNull(activeBranchesCount) ?? 0;

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

async function getTenantOrThrow(tenantId) {
  const safeTenantId = cleanString(tenantId);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: safeTenantId },
    select: {
      id: true,
      name: true,
      status: true,
      mainBranchId: true,
    },
  });

  if (!tenant) {
    const err = new Error("Tenant not found");
    err.status = 404;
    throw err;
  }

  return tenant;
}

async function getSubscriptionOrThrow(tenantId) {
  const safeTenantId = cleanString(tenantId);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { tenantId: safeTenantId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      accessMode: true,
      planKey: true,
      tierKey: true,
      cycleKey: true,
      staffLimit: true,
      branchLimit: true,
      extraBranchCount: true,
      priceAmount: true,
      currency: true,
      startDate: true,
      endDate: true,
      graceEndDate: true,
      readOnlySince: true,
      lastPaymentAt: true,
      renewedAt: true,
      createdAt: true,
    },
  });

  if (!subscription) {
    const err = new Error("Subscription not found");
    err.status = 404;
    throw err;
  }

  return subscription;
}

async function countActiveBranches(tenantId) {
  return prisma.branch.count({
    where: {
      tenantId: cleanString(tenantId),
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
  });
}

async function getTenantBranchUsage(tenantId) {
  const [tenant, subscription, activeBranches] = await Promise.all([
    getTenantOrThrow(tenantId),
    getSubscriptionOrThrow(tenantId),
    countActiveBranches(tenantId),
  ]);

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      mainBranchId: tenant.mainBranchId || null,
    },
    subscription: {
      id: subscription.id,
      status: subscription.status,
      accessMode: subscription.accessMode,
      planKey: subscription.planKey || null,
      tierKey: subscription.tierKey || null,
      cycleKey: subscription.cycleKey || null,
      staffLimit: subscription.staffLimit ?? null,
      branchLimit: subscription.branchLimit ?? null,
      extraBranchCount: subscription.extraBranchCount ?? 0,
      priceAmount: subscription.priceAmount ?? null,
      currency: subscription.currency || null,
      startDate: subscription.startDate || null,
      endDate: subscription.endDate || null,
      graceEndDate: subscription.graceEndDate || null,
      readOnlySince: subscription.readOnlySince || null,
      lastPaymentAt: subscription.lastPaymentAt || null,
      renewedAt: subscription.renewedAt || null,
      createdAt: subscription.createdAt || null,
    },
    usage: computeBranchUsage(subscription, activeBranches),
  };
}

async function listBranches(tenantId) {
  const safeTenantId = cleanString(tenantId);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  const branches = await prisma.branch.findMany({
    where: {
      tenantId: safeTenantId,
    },
    orderBy: [
      { isMain: "desc" },
      { status: "asc" },
      { createdAt: "asc" },
    ],
    select: {
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
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return branches.map(formatBranch);
}

async function assertActorCanManageBranches({ actorUserId, actorRole, tenantId }) {
  const safeActorUserId = cleanString(actorUserId);
  const safeTenantId = cleanString(tenantId);

  if (!safeActorUserId || !safeTenantId) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  if (!isOwnerOrManager(actorRole)) {
    const err = new Error("Forbidden");
    err.status = 403;
    err.code = "BRANCH_MANAGEMENT_FORBIDDEN";
    throw err;
  }

  const actor = await prisma.user.findFirst({
    where: {
      id: safeActorUserId,
      tenantId: safeTenantId,
      isActive: true,
    },
    select: {
      id: true,
      tenantId: true,
      role: true,
      isActive: true,
    },
  });

  if (!actor) {
    const err = new Error("Actor not found");
    err.status = 404;
    throw err;
  }

  return actor;
}

async function assertBranchCreationAllowed(tenantId) {
  const branchUsage = await getTenantBranchUsage(tenantId);

  if (!branchUsage.usage.canAddBranch) {
    const err = new Error("Branch limit reached");
    err.status = 403;
    err.code = "BRANCH_LIMIT_REACHED";
    err.details = branchUsage;
    throw err;
  }

  return branchUsage;
}

async function ensureUniqueBranchNameAndCode({
  tenantId,
  name,
  code,
}) {
  const safeTenantId = cleanString(tenantId);
  const normalizedName = normalizeBranchName(name);
  const normalizedCode = normalizeBranchCode(code);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  if (!normalizedName) {
    const err = new Error("Branch name is required");
    err.status = 400;
    throw err;
  }

  if (!normalizedCode) {
    const err = new Error("Branch code is required");
    err.status = 400;
    throw err;
  }

  const [sameCode, existingBranches] = await Promise.all([
    prisma.branch.findFirst({
      where: {
        tenantId: safeTenantId,
        code: normalizedCode,
      },
      select: {
        id: true,
        name: true,
        code: true,
      },
    }),
    prisma.branch.findMany({
      where: {
        tenantId: safeTenantId,
      },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  if (sameCode) {
    const err = new Error("Branch code already exists");
    err.status = 409;
    err.code = "BRANCH_CODE_ALREADY_EXISTS";
    throw err;
  }

  const lowerIncomingName = normalizedName.toLowerCase();
  const sameName = existingBranches.find(
    (branch) => String(branch.name || "").trim().toLowerCase() === lowerIncomingName
  );

  if (sameName) {
    const err = new Error("Branch name already exists");
    err.status = 409;
    err.code = "BRANCH_NAME_ALREADY_EXISTS";
    throw err;
  }

  return {
    normalizedName,
    normalizedCode,
  };
}

async function createBranch({
  tenantId,
  actorUserId,
  actorRole,
  name,
  code,
  phone,
  email,
  countryCode,
  district,
  sector,
  address,
}) {
  const safeTenantId = cleanString(tenantId);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const [branchUsage, normalized] = await Promise.all([
    assertBranchCreationAllowed(safeTenantId),
    ensureUniqueBranchNameAndCode({
      tenantId: safeTenantId,
      name,
      code,
    }),
  ]);

  const created = await prisma.branch.create({
    data: {
      tenantId: safeTenantId,
      name: normalized.normalizedName,
      code: normalized.normalizedCode,
      type: "STANDARD",
      status: "ACTIVE",
      phone: normalizeOptionalText(phone),
      email: normalizeOptionalText(email),
      countryCode: normalizeUpper(countryCode) || "RW",
      district: normalizeOptionalText(district),
      sector: normalizeOptionalText(sector),
      address: normalizeOptionalText(address),
      isMain: false,
      createdById: cleanString(actorUserId),
    },
    select: {
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
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const updatedUsage = await getTenantBranchUsage(safeTenantId);

  return {
    branch: formatBranch(created),
    usageBefore: branchUsage.usage,
    usageAfter: updatedUsage.usage,
    subscription: updatedUsage.subscription,
  };
}

module.exports = {
  computeBranchUsage,
  getTenantBranchUsage,
  listBranches,
  createBranch,
};