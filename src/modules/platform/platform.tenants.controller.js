const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");
const {
  TenantStatus,
  SubscriptionAccessMode,
  SubscriptionStatus,
  UserRole,
} = require("@prisma/client");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getPlatformUser(req) {
  return req.platformUser || req.user || null;
}

function getPlatformRole(req) {
  return String(getPlatformUser(req)?.role || "").toUpperCase();
}

function requireOwnerOrAdmin(req) {
  const role = getPlatformRole(req);
  return role === "PLATFORM_OWNER" || role === "PLATFORM_ADMIN";
}

function requireOwner(req) {
  return getPlatformRole(req) === "PLATFORM_OWNER";
}

function normalizeTenantStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(TenantStatus).includes(raw) ? raw : null;
}

function normalizeSubscriptionStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(SubscriptionStatus).includes(raw) ? raw : null;
}

function normalizeSubscriptionAccessMode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(SubscriptionAccessMode).includes(raw) ? raw : null;
}

function tenantSelect() {
  return {
    id: true,
    name: true,
    email: true,
    phone: true,
    status: true,
    createdAt: true,

    shopType: true,
    district: true,
    sector: true,
    address: true,
    countryCode: true,
    currencyCode: true,
    timezone: true,
    onboardingCompleted: true,
    onboardingCompletedAt: true,

    subscription: {
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
        trialStartDate: true,
        trialEndDate: true,
        graceEndDate: true,
        readOnlySince: true,
        lastPaymentAt: true,
        renewedAt: true,
        createdAt: true,
      },
    },

    users: {
      where: { role: UserRole.OWNER },
      take: 1,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    },

    branches: {
      orderBy: [{ isMain: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        tenantId: true,
        name: true,
        code: true,
        type: true,
        status: true,
        phone: true,
        email: true,
        district: true,
        sector: true,
        address: true,
        isMain: true,
        createdAt: true,
        updatedAt: true,
      },
    },

    _count: {
      select: {
        branches: true,
        users: true,
        customers: true,
        products: true,
        sales: true,
        repairs: true,
        expenses: true,
        suppliers: true,
      },
    },
  };
}

function publicTenantRow(tenant) {
  const owner = Array.isArray(tenant.users) && tenant.users.length ? tenant.users[0] : null;

  return {
    id: tenant.id,
    name: tenant.name,
    email: tenant.email,
    phone: tenant.phone,
    status: tenant.status,
    platformStatus: tenant.status,
    createdAt: tenant.createdAt,

    businessProfile: {
      shopType: tenant.shopType || null,
      district: tenant.district || null,
      sector: tenant.sector || null,
      address: tenant.address || null,
      countryCode: tenant.countryCode || "RW",
      currencyCode: tenant.currencyCode || "RWF",
      timezone: tenant.timezone || "Africa/Kigali",
      onboardingCompleted: Boolean(tenant.onboardingCompleted),
      onboardingCompletedAt: tenant.onboardingCompletedAt || null,
    },

    owner,
    subscription: tenant.subscription || null,

    usage: {
      storeLocations: safeNumber(tenant._count?.branches),
      users: safeNumber(tenant._count?.users),
      customers: safeNumber(tenant._count?.customers),
      products: safeNumber(tenant._count?.products),
      sales: safeNumber(tenant._count?.sales),
      repairs: safeNumber(tenant._count?.repairs),
      expenses: safeNumber(tenant._count?.expenses),
      suppliers: safeNumber(tenant._count?.suppliers),
    },

    storeLocations: tenant.branches || [],
  };
}

function buildTenantHealth({ tenant, owner, usage, subscription }) {
  const issues = [];

  if (!owner) {
    issues.push({
      code: "OWNER_MISSING",
      severity: "danger",
      message: "No owner account is linked to this business.",
    });
  }

  if (usage.users <= 0) {
    issues.push({
      code: "NO_TEAM_MEMBERS",
      severity: "warning",
      message: "No team member accounts were found.",
    });
  }

  if (usage.storeLocations <= 0) {
    issues.push({
      code: "NO_STORE_LOCATIONS",
      severity: "danger",
      message: "No store location exists for this business.",
    });
  }

  if (!subscription) {
    issues.push({
      code: "SUBSCRIPTION_MISSING",
      severity: "danger",
      message: "No subscription record is linked to this business.",
    });
  } else {
    if (subscription.status === "EXPIRED") {
      issues.push({
        code: "SUBSCRIPTION_EXPIRED",
        severity: "warning",
        message: "The subscription is expired.",
      });
    }

    if (subscription.status === "SUSPENDED" || subscription.accessMode === "SUSPENDED") {
      issues.push({
        code: "SUBSCRIPTION_SUSPENDED",
        severity: "danger",
        message: "The subscription is suspended.",
      });
    }

    if (subscription.accessMode === "READ_ONLY") {
      issues.push({
        code: "READ_ONLY_ACCESS",
        severity: "warning",
        message: "This business currently has read-only access.",
      });
    }
  }

  if (tenant.status === "SUSPENDED") {
    issues.push({
      code: "TENANT_SUSPENDED",
      severity: "danger",
      message: "This business is suspended at platform level.",
    });
  }

  return {
    status: issues.some((issue) => issue.severity === "danger")
      ? "NEEDS_ATTENTION"
      : issues.length
        ? "WATCH"
        : "HEALTHY",
    issues,
  };
}

async function getPlatformOverview(req, res) {
  try {
    const [
      tenants,
      users,
      storeLocations,
      customers,
      products,
      sales,
      repairs,
      expenses,
      activeSubscriptions,
      expiredSubscriptions,
      suspendedSubscriptions,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.branch.count(),
      prisma.customer.count(),
      prisma.product.count(),
      prisma.sale.count(),
      prisma.repair.count(),
      prisma.expense.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: "EXPIRED" } }),
      prisma.subscription.count({ where: { status: "SUSPENDED" } }),
    ]);

    return res.json({
      overview: {
        tenants,
        users,
        storeLocations,
        customers,
        products,
        sales,
        repairs,
        expenses,
        subscriptions: {
          active: activeSubscriptions,
          expired: expiredSubscriptions,
          suspended: suspendedSubscriptions,
        },
      },
    });
  } catch (err) {
    console.error("getPlatformOverview error:", err);
    return res.status(500).json({
      message: "Failed to load platform overview",
      code: "PLATFORM_OVERVIEW_FAILED",
    });
  }
}

async function listTenants(req, res) {
  try {
    const q = String(req.query?.q || "").trim();
    const status = normalizeTenantStatus(req.query?.status);
    const subscriptionStatus = normalizeSubscriptionStatus(req.query?.subscriptionStatus);
    const accessMode = normalizeSubscriptionAccessMode(req.query?.accessMode);

    const takeRaw = Number(req.query?.take || 50);
    const skipRaw = Number(req.query?.skip || 0);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;
    const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { shopType: { contains: q, mode: "insensitive" } },
              { district: { contains: q, mode: "insensitive" } },
              { sector: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(subscriptionStatus || accessMode
        ? {
            subscription: {
              ...(subscriptionStatus ? { status: subscriptionStatus } : {}),
              ...(accessMode ? { accessMode } : {}),
            },
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: tenantSelect(),
      }),
      prisma.tenant.count({ where }),
    ]);

    const tenants = rows.map(publicTenantRow);

    return res.json({
      tenants,
      count,
      page: {
        skip,
        take,
        returned: tenants.length,
        hasMore: skip + tenants.length < count,
      },
    });
  } catch (err) {
    console.error("listTenants error:", err);
    return res.status(500).json({
      message: "Failed to load tenants",
      code: "PLATFORM_TENANTS_LIST_FAILED",
    });
  }
}

async function getTenantDetail(req, res) {
  const tenantId = cleanString(req.params?.id);

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: tenantSelect(),
    });

    if (!tenant) {
      return res.status(404).json({
        message: "Tenant not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    const [teamMembers, salesSummary, recentSales] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      }),

      prisma.sale.aggregate({
        where: {
          tenantId,
          isCancelled: false,
        },
        _count: { _all: true },
        _sum: {
          total: true,
          amountPaid: true,
          balanceDue: true,
        },
      }),

      prisma.sale.findMany({
        where: {
          tenantId,
          isCancelled: false,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          branchId: true,
          createdAt: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          saleType: true,
          status: true,
          receiptNumber: true,
          invoiceNumber: true,
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          cashier: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              isMain: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const row = publicTenantRow(tenant);
    const owner = row.owner;
    const usage = row.usage;
    const subscription = row.subscription;

    return res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        phone: tenant.phone,
        status: tenant.status,
        createdAt: tenant.createdAt,
        platformStatus: tenant.status,
        businessProfile: row.businessProfile,
      },
      owner,
      subscription,
      usage,
      health: buildTenantHealth({ tenant, owner, usage, subscription }),
      storeLocations: row.storeLocations,
      teamMembers,
      salesSummary: {
        salesCount: salesSummary._count?._all || 0,
        totalSalesValue: safeNumber(salesSummary._sum?.total),
        totalPaid: safeNumber(salesSummary._sum?.amountPaid),
        totalOutstanding: safeNumber(salesSummary._sum?.balanceDue),
      },
      recentSales,
    });
  } catch (err) {
    console.error("getTenantDetail error:", err);
    return res.status(500).json({
      message: "Failed to load tenant detail",
      code: "PLATFORM_TENANT_DETAIL_FAILED",
    });
  }
}

async function updateTenantStatus(req, res) {
  const tenantId = cleanString(req.params?.id);
  const nextStatus = normalizeTenantStatus(req.body?.status);

  if (!requireOwnerOrAdmin(req)) {
    return res.status(403).json({
      message: "Only platform owner or platform admin can update business status",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  if (!nextStatus) {
    return res.status(400).json({
      message: `status must be one of ${Object.values(TenantStatus).join(", ")}`,
      code: "INVALID_TENANT_STATUS",
    });
  }

  try {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { status: nextStatus },
      select: tenantSelect(),
    });

    return res.json({
      message: "Tenant status updated",
      tenant: publicTenantRow(updated),
    });
  } catch (err) {
    if (err?.code === "P2025") {
      return res.status(404).json({
        message: "Tenant not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    console.error("updateTenantStatus error:", err);
    return res.status(500).json({
      message: "Failed to update tenant status",
      code: "PLATFORM_TENANT_STATUS_UPDATE_FAILED",
    });
  }
}

async function updateSubscriptionAccess(req, res) {
  const tenantId = cleanString(req.params?.id);
  const nextAccessMode = normalizeSubscriptionAccessMode(req.body?.accessMode);
  const nextStatus =
    req.body?.status === undefined ? null : normalizeSubscriptionStatus(req.body?.status);

  if (!requireOwnerOrAdmin(req)) {
    return res.status(403).json({
      message: "Only platform owner or platform admin can update subscription access",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  if (!nextAccessMode) {
    return res.status(400).json({
      message: `accessMode must be one of ${Object.values(SubscriptionAccessMode).join(", ")}`,
      code: "INVALID_SUBSCRIPTION_ACCESS_MODE",
    });
  }

  if (req.body?.status !== undefined && !nextStatus) {
    return res.status(400).json({
      message: `status must be one of ${Object.values(SubscriptionStatus).join(", ")}`,
      code: "INVALID_SUBSCRIPTION_STATUS",
    });
  }

  try {
    const existing = await prisma.subscription.findUnique({
      where: { tenantId },
      select: { id: true, tenantId: true },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Subscription not found for this tenant",
        code: "SUBSCRIPTION_NOT_FOUND",
      });
    }

    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: {
        accessMode: nextAccessMode,
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(nextAccessMode === "READ_ONLY" ? { readOnlySince: new Date() } : {}),
        ...(nextAccessMode !== "READ_ONLY" ? { readOnlySince: null } : {}),
      },
    });

    return res.json({
      message: "Subscription access updated",
      subscription: updated,
    });
  } catch (err) {
    console.error("updateSubscriptionAccess error:", err);
    return res.status(500).json({
      message: "Failed to update subscription access",
      code: "PLATFORM_SUBSCRIPTION_ACCESS_UPDATE_FAILED",
    });
  }
}

async function repairMissingOwner(req, res) {
  const tenantId = cleanString(req.params?.id);

  const name = cleanString(req.body?.name);
  const email = cleanString(req.body?.email);
  const phone = cleanString(req.body?.phone);
  const temporaryPassword = String(req.body?.temporaryPassword || "");

  if (!requireOwner(req)) {
    return res.status(403).json({
      message: "Only platform owner can repair a missing tenant owner",
      code: "PLATFORM_OWNER_REQUIRED",
    });
  }

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  if (!name || !email || !phone || !temporaryPassword) {
    return res.status(400).json({
      message: "name, email, phone, and temporaryPassword are required",
      code: "OWNER_REPAIR_FIELDS_REQUIRED",
    });
  }

  if (temporaryPassword.length < 8) {
    return res.status(400).json({
      message: "temporaryPassword must be at least 8 characters",
      code: "TEMPORARY_PASSWORD_TOO_SHORT",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          status: true,
        },
      });

      if (!tenant) {
        const err = new Error("TENANT_NOT_FOUND");
        err.code = "TENANT_NOT_FOUND";
        throw err;
      }

      const existingOwner = await tx.user.findFirst({
        where: {
          tenantId,
          role: UserRole.OWNER,
        },
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      if (existingOwner) {
        const err = new Error("OWNER_ALREADY_EXISTS");
        err.code = "OWNER_ALREADY_EXISTS";
        err.owner = existingOwner;
        throw err;
      }

      const passwordHash = await bcrypt.hash(temporaryPassword, 12);

      const owner = await tx.user.create({
        data: {
          tenantId,
          name,
          email,
          phone,
          password: passwordHash,
          role: UserRole.OWNER,
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
          createdAt: true,
        },
      });

      return { tenant, owner };
    });

    return res.status(201).json({
      message: "Tenant owner account repaired",
      tenant: result.tenant,
      owner: result.owner,
    });
  } catch (err) {
    if (err?.code === "TENANT_NOT_FOUND") {
      return res.status(404).json({
        message: "Tenant not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    if (err?.code === "OWNER_ALREADY_EXISTS") {
      return res.status(409).json({
        message: "This tenant already has an owner account",
        code: "OWNER_ALREADY_EXISTS",
        owner: err.owner || null,
      });
    }

    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "A user with this email or phone already exists",
        code: "OWNER_EMAIL_OR_PHONE_ALREADY_EXISTS",
      });
    }

    console.error("repairMissingOwner error:", err);
    return res.status(500).json({
      message: "Failed to repair missing owner",
      code: "PLATFORM_OWNER_REPAIR_FAILED",
    });
  }
}

module.exports = {
  getPlatformOverview,
  listTenants,
  getTenantDetail,
  updateTenantStatus,
  updateSubscriptionAccess,
  repairMissingOwner,
};