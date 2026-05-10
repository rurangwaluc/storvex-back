// backend/src/modules/branches/branches.service.js
const prisma = require("../../config/database");

const STORE_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "STOREKEEPER",
  "SELLER",
  "CASHIER",
  "TECHNICIAN",
]);

const BRANCH_VISIBLE_STATUSES = ["ACTIVE", "CLOSED", "ARCHIVED"];
const BRANCH_USAGE_COUNTED_STATUSES = ["ACTIVE", "CLOSED"];

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
  return cleanString(value);
}

function normalizeOptionalText(value, maxLen = null) {
  const s = cleanString(value);
  if (!s) return null;
  if (maxLen && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function normalizeOptionalEmail(value) {
  const s = cleanString(value);
  return s ? s.toLowerCase() : null;
}

function normalizeOptionalPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (digits.startsWith("07") && digits.length === 10) {
    return `250${digits.slice(1)}`;
  }

  if (digits.startsWith("2507") && digits.length === 12) {
    return digits;
  }

  return digits;
}

function toPositiveIntOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return fallback;
}

function isOwnerOrManager(role) {
  const normalized = normalizeUpper(role);
  return normalized === "OWNER" || normalized === "MANAGER";
}

function assertTenantId(tenantId) {
  const safeTenantId = cleanString(tenantId);

  if (!safeTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  return safeTenantId;
}

function assertBranchId(branchId) {
  const safeBranchId = cleanString(branchId);

  if (!safeBranchId) {
    const err = new Error("branchId is required");
    err.status = 400;
    throw err;
  }

  return safeBranchId;
}

function assertUserId(userId) {
  const safeUserId = cleanString(userId);

  if (!safeUserId) {
    const err = new Error("userId is required");
    err.status = 400;
    throw err;
  }

  return safeUserId;
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

function formatBranchStaffAssignment(assignment) {
  if (!assignment) return null;

  return {
    id: assignment.id,
    tenantId: assignment.tenantId,
    userId: assignment.userId,
    branchId: assignment.branchId,
    isDefault: Boolean(assignment.isDefault),
    canOperate: Boolean(assignment.canOperate),
    canViewReports: Boolean(assignment.canViewReports),
    createdAt: assignment.createdAt || null,
    user: assignment.user
      ? {
          id: assignment.user.id,
          name: assignment.user.name,
          email: assignment.user.email,
          phone: assignment.user.phone,
          role: assignment.user.role,
          isActive: Boolean(assignment.user.isActive),
        }
      : null,
    branch: assignment.branch ? formatBranch(assignment.branch) : null,
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

async function writeBranchAudit({
  tx = prisma,
  tenantId,
  branchId,
  actorUserId,
  action,
  metadata = {},
}) {
  if (!tenantId || !action) return null;

  return tx.auditLog
    .create({
      data: {
        tenantId,
        branchId: branchId || null,
        userId: actorUserId || null,
        entity: "BRANCH",
        entityId: branchId || null,
        action,
        metadata,
      },
    })
    .catch((err) => {
      console.error("writeBranchAudit failed:", err?.message || err);
      return null;
    });
}

async function getTenantOrThrow(tenantId) {
  const safeTenantId = assertTenantId(tenantId);

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
  const safeTenantId = assertTenantId(tenantId);

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
      tenantId: assertTenantId(tenantId),
      status: {
        in: BRANCH_USAGE_COUNTED_STATUSES,
      },
    },
  });
}

async function getTenantBranchUsage(tenantId) {
  const safeTenantId = assertTenantId(tenantId);

  const [tenant, subscription, activeBranches] = await Promise.all([
    getTenantOrThrow(safeTenantId),
    getSubscriptionOrThrow(safeTenantId),
    countActiveBranches(safeTenantId),
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
  const safeTenantId = assertTenantId(tenantId);

  const branches = await prisma.branch.findMany({
    where: {
      tenantId: safeTenantId,
      status: {
        in: BRANCH_VISIBLE_STATUSES,
      },
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

async function getBranchById(tenantId, branchId) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  const branch = await prisma.branch.findFirst({
    where: {
      id: safeBranchId,
      tenantId: safeTenantId,
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

  if (!branch) {
    const err = new Error("Branch not found");
    err.status = 404;
    throw err;
  }

  return formatBranch(branch);
}

async function getBranchStaff(tenantId, branchId) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await getBranchById(safeTenantId, safeBranchId);

  const assignments = await prisma.userBranchAssignment.findMany({
    where: {
      tenantId: safeTenantId,
      branchId: safeBranchId,
      user: {
        tenantId: safeTenantId,
        isActive: true,
      },
    },
    orderBy: [
      { isDefault: "desc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      tenantId: true,
      userId: true,
      branchId: true,
      isDefault: true,
      canOperate: true,
      canViewReports: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
        },
      },
      branch: {
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
      },
    },
  });

  return assignments.map(formatBranchStaffAssignment);
}

async function assertActorCanManageBranches({ actorUserId, actorRole, tenantId }) {
  const safeActorUserId = assertUserId(actorUserId);
  const safeTenantId = assertTenantId(tenantId);

  if (!isOwnerOrManager(actorRole)) {
    const err = new Error("Only owner or manager can manage branches");
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
  excludeBranchId = null,
}) {
  const safeTenantId = assertTenantId(tenantId);
  const normalizedName = normalizeBranchName(name);
  const normalizedCode = normalizeBranchCode(code);
  const safeExcludeBranchId = cleanString(excludeBranchId);

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
        ...(safeExcludeBranchId ? { id: { not: safeExcludeBranchId } } : {}),
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
        ...(safeExcludeBranchId ? { id: { not: safeExcludeBranchId } } : {}),
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

async function assertBranchBelongsToTenant(tenantId, branchId) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  const branch = await prisma.branch.findFirst({
    where: {
      id: safeBranchId,
      tenantId: safeTenantId,
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

  if (!branch) {
    const err = new Error("Branch not found");
    err.status = 404;
    throw err;
  }

  return branch;
}

async function assertUserBelongsToTenant(tenantId, userId) {
  const safeTenantId = assertTenantId(tenantId);
  const safeUserId = assertUserId(userId);

  const user = await prisma.user.findFirst({
    where: {
      id: safeUserId,
      tenantId: safeTenantId,
      isActive: true,
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    const err = new Error("Staff member not found");
    err.status = 404;
    throw err;
  }

  if (!STORE_ROLES.has(String(user.role || "").toUpperCase())) {
    const err = new Error("This user role cannot be assigned to a store branch");
    err.status = 400;
    err.code = "BRANCH_ASSIGNMENT_ROLE_NOT_ALLOWED";
    throw err;
  }

  return user;
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
  const safeTenantId = assertTenantId(tenantId);

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

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({
      data: {
        tenantId: safeTenantId,
        name: normalized.normalizedName,
        code: normalized.normalizedCode,
        type: "STANDARD",
        status: "ACTIVE",
        phone: normalizeOptionalPhone(phone),
        email: normalizeOptionalEmail(email),
        countryCode: normalizeUpper(countryCode) || "RW",
        district: normalizeOptionalText(district, 120),
        sector: normalizeOptionalText(sector, 120),
        address: normalizeOptionalText(address, 255),
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

    await writeBranchAudit({
      tx,
      tenantId: safeTenantId,
      branchId: created.id,
      actorUserId,
      action: "BRANCH_CREATED",
      metadata: {
        name: created.name,
        code: created.code,
        usageBefore: branchUsage.usage,
      },
    });

    return created;
  });

  const updatedUsage = await getTenantBranchUsage(safeTenantId);

  return {
    branch: formatBranch(result),
    usageBefore: branchUsage.usage,
    usageAfter: updatedUsage.usage,
    subscription: updatedUsage.subscription,
  };
}

async function updateBranch({
  tenantId,
  branchId,
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
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const existing = await assertBranchBelongsToTenant(safeTenantId, safeBranchId);

  if (existing.status === "ARCHIVED") {
    const err = new Error("Archived branch cannot be edited. Reactivate it first.");
    err.status = 400;
    err.code = "BRANCH_ARCHIVED";
    throw err;
  }

  const incomingName = "name" in arguments[0] ? name : existing.name;
  const incomingCode = "code" in arguments[0] ? code : existing.code;

  const normalized = await ensureUniqueBranchNameAndCode({
    tenantId: safeTenantId,
    name: incomingName,
    code: incomingCode,
    excludeBranchId: safeBranchId,
  });

  const data = {
    name: normalized.normalizedName,
    code: normalized.normalizedCode,
  };

  if ("phone" in arguments[0]) data.phone = normalizeOptionalPhone(phone);
  if ("email" in arguments[0]) data.email = normalizeOptionalEmail(email);
  if ("countryCode" in arguments[0]) data.countryCode = normalizeUpper(countryCode) || "RW";
  if ("district" in arguments[0]) data.district = normalizeOptionalText(district, 120);
  if ("sector" in arguments[0]) data.sector = normalizeOptionalText(sector, 120);
  if ("address" in arguments[0]) data.address = normalizeOptionalText(address, 255);

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.branch.update({
      where: { id: safeBranchId },
      data,
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

    await writeBranchAudit({
      tx,
      tenantId: safeTenantId,
      branchId: safeBranchId,
      actorUserId,
      action: "BRANCH_UPDATED",
      metadata: {
        before: formatBranch(existing),
        after: formatBranch(next),
      },
    });

    return next;
  });

  return formatBranch(updated);
}

async function setMainBranch({ tenantId, branchId, actorUserId, actorRole }) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const target = await assertBranchBelongsToTenant(safeTenantId, safeBranchId);

  if (target.status !== "ACTIVE") {
    const err = new Error("Only an active branch can be set as main branch");
    err.status = 400;
    err.code = "MAIN_BRANCH_MUST_BE_ACTIVE";
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: safeTenantId },
      select: {
        id: true,
        mainBranchId: true,
      },
    });

    await tx.branch.updateMany({
      where: {
        tenantId: safeTenantId,
        isMain: true,
      },
      data: {
        isMain: false,
        type: "STANDARD",
      },
    });

    const main = await tx.branch.update({
      where: { id: safeBranchId },
      data: {
        isMain: true,
        type: "MAIN",
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

    await tx.tenant.update({
      where: { id: safeTenantId },
      data: {
        mainBranchId: safeBranchId,
      },
      select: { id: true },
    });

    await writeBranchAudit({
      tx,
      tenantId: safeTenantId,
      branchId: safeBranchId,
      actorUserId,
      action: "BRANCH_SET_MAIN",
      metadata: {
        previousMainBranchId: tenant?.mainBranchId || null,
        nextMainBranchId: safeBranchId,
      },
    });

    return main;
  });

  return formatBranch(updated);
}

async function archiveBranch({ tenantId, branchId, actorUserId, actorRole }) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const existing = await assertBranchBelongsToTenant(safeTenantId, safeBranchId);

  if (existing.isMain) {
    const err = new Error("Main branch cannot be archived. Set another main branch first.");
    err.status = 400;
    err.code = "MAIN_BRANCH_CANNOT_BE_ARCHIVED";
    throw err;
  }

  if (existing.status === "ARCHIVED") {
    return formatBranch(existing);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.branch.update({
      where: { id: safeBranchId },
      data: {
        status: "ARCHIVED",
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

    await tx.userBranchAssignment.deleteMany({
      where: {
        tenantId: safeTenantId,
        branchId: safeBranchId,
      },
    });

    await writeBranchAudit({
      tx,
      tenantId: safeTenantId,
      branchId: safeBranchId,
      actorUserId,
      action: "BRANCH_ARCHIVED",
      metadata: {
        before: formatBranch(existing),
        removedAssignments: true,
      },
    });

    return next;
  });

  return formatBranch(updated);
}

async function reactivateBranch({ tenantId, branchId, actorUserId, actorRole }) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const existing = await assertBranchBelongsToTenant(safeTenantId, safeBranchId);

  if (existing.status === "ACTIVE") {
    return formatBranch(existing);
  }

  const branchUsage = await getTenantBranchUsage(safeTenantId);

  if (!branchUsage.usage.canAddBranch) {
    const err = new Error("Branch limit reached. Upgrade or add branch capacity before reactivating.");
    err.status = 403;
    err.code = "BRANCH_LIMIT_REACHED";
    err.details = branchUsage;
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.branch.update({
      where: { id: safeBranchId },
      data: {
        status: "ACTIVE",
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

    await writeBranchAudit({
      tx,
      tenantId: safeTenantId,
      branchId: safeBranchId,
      actorUserId,
      action: "BRANCH_REACTIVATED",
      metadata: {
        before: formatBranch(existing),
        after: formatBranch(next),
      },
    });

    return next;
  });

  return formatBranch(updated);
}

function normalizeStaffAssignmentsPayload(payload) {
  const raw =
    Array.isArray(payload?.assignments)
      ? payload.assignments
      : Array.isArray(payload?.staff)
        ? payload.staff
        : Array.isArray(payload?.users)
          ? payload.users
          : [];

  return raw
    .map((item) => ({
      userId: cleanString(item?.userId || item?.id),
      isDefault: toBool(item?.isDefault, false),
      canOperate: toBool(item?.canOperate, true),
      canViewReports: toBool(item?.canViewReports, false),
    }))
    .filter((item) => Boolean(item.userId));
}

async function updateBranchStaff({
  tenantId,
  branchId,
  actorUserId,
  actorRole,
  assignments = [],
  staff = null,
  users = null,
}) {
  const safeTenantId = assertTenantId(tenantId);
  const safeBranchId = assertBranchId(branchId);

  await assertActorCanManageBranches({
    actorUserId,
    actorRole,
    tenantId: safeTenantId,
  });

  const branch = await assertBranchBelongsToTenant(safeTenantId, safeBranchId);

  if (branch.status !== "ACTIVE") {
    const err = new Error("Staff can only be assigned to an active branch");
    err.status = 400;
    err.code = "BRANCH_NOT_ACTIVE";
    throw err;
  }

  const normalizedAssignments = normalizeStaffAssignmentsPayload({
    assignments,
    staff,
    users,
  });

  const uniqueByUser = new Map();
  normalizedAssignments.forEach((item) => {
    uniqueByUser.set(item.userId, item);
  });

  const nextAssignments = Array.from(uniqueByUser.values());

  for (const item of nextAssignments) {
    await assertUserBelongsToTenant(safeTenantId, item.userId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.userBranchAssignment.findMany({
      where: {
        tenantId: safeTenantId,
        branchId: safeBranchId,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    const nextUserIds = new Set(nextAssignments.map((item) => item.userId));
    const existingUserIds = new Set(existing.map((item) => item.userId));

    const removedUserIds = existing
      .filter((item) => !nextUserIds.has(item.userId))
      .map((item) => item.userId);

    if (removedUserIds.length) {
      await tx.userBranchAssignment.deleteMany({
        where: {
          tenantId: safeTenantId,
          branchId: safeBranchId,
          userId: {
            in: removedUserIds,
          },
        },
      });
    }

    for (const item of nextAssignments) {
      if (item.isDefault) {
        await tx.userBranchAssignment.updateMany({
          where: {
            tenantId: safeTenantId,
            userId: item.userId,
            branchId: {
              not: safeBranchId,
            },
          },
          data: {
            isDefault: false,
          },
        });
      }

      await tx.userBranchAssignment.upsert({
        where: {
          userId_branchId: {
            userId: item.userId,
            branchId: safeBranchId,
          },
        },
        update: {
          isDefault: item.isDefault,
          canOperate: item.canOperate,
          canViewReports: item.canViewReports,
        },
        create: {
          tenantId: safeTenantId,
          userId: item.userId,
          branchId: safeBranchId,
          isDefault: item.isDefault,
          canOperate: item.canOperate,
          canViewReports: item.canViewReports,
        },
      });
    }

    const addedUserIds = nextAssignments
      .filter((item) => !existingUserIds.has(item.userId))
      .map((item) => item.userId);

    const updatedUserIds = nextAssignments
      .filter((item) => existingUserIds.has(item.userId))
      .map((item) => item.userId);

    if (addedUserIds.length) {
      await writeBranchAudit({
        tx,
        tenantId: safeTenantId,
        branchId: safeBranchId,
        actorUserId,
        action: "BRANCH_STAFF_ASSIGNED",
        metadata: {
          addedUserIds,
        },
      });
    }

    if (removedUserIds.length) {
      await writeBranchAudit({
        tx,
        tenantId: safeTenantId,
        branchId: safeBranchId,
        actorUserId,
        action: "BRANCH_STAFF_REMOVED",
        metadata: {
          removedUserIds,
        },
      });
    }

    if (updatedUserIds.length) {
      await writeBranchAudit({
        tx,
        tenantId: safeTenantId,
        branchId: safeBranchId,
        actorUserId,
        action: "BRANCH_UPDATED",
        metadata: {
          updatedStaffUserIds: updatedUserIds,
        },
      });
    }

    return tx.userBranchAssignment.findMany({
      where: {
        tenantId: safeTenantId,
        branchId: safeBranchId,
      },
      orderBy: [
        { isDefault: "desc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        tenantId: true,
        userId: true,
        branchId: true,
        isDefault: true,
        canOperate: true,
        canViewReports: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
          },
        },
        branch: {
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
        },
      },
    });
  });

  return result.map(formatBranchStaffAssignment);
}

module.exports = {
  computeBranchUsage,
  getTenantBranchUsage,
  listBranches,
  getBranchById,
  getBranchStaff,
  createBranch,
  updateBranch,
  setMainBranch,
  archiveBranch,
  reactivateBranch,
  updateBranchStaff,
};