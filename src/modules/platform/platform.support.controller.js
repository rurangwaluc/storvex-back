const prisma = require("../../config/database");
const {
  SubscriptionAccessMode,
  SubscriptionStatus,
  TenantStatus,
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

function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntil(dateValue) {
  const d = toDateOrNull(dateValue);
  if (!d) return null;

  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
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

function tenantBaseSelect() {
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
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
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
        auditLogs: true,
      },
    },
  };
}

function businessProfile(tenant) {
  return {
    shopType: tenant.shopType || null,
    district: tenant.district || null,
    sector: tenant.sector || null,
    address: tenant.address || null,
    countryCode: tenant.countryCode || "RW",
    currencyCode: tenant.currencyCode || "RWF",
    timezone: tenant.timezone || "Africa/Kigali",
    onboardingCompleted: Boolean(tenant.onboardingCompleted),
    onboardingCompletedAt: tenant.onboardingCompletedAt || null,
  };
}

function subscriptionHealth(subscription) {
  if (!subscription) {
    return {
      status: "MISSING",
      label: "Missing subscription",
      severity: "danger",
    };
  }

  if (
    subscription.status === "SUSPENDED" ||
    subscription.accessMode === "SUSPENDED"
  ) {
    return {
      status: "SUSPENDED",
      label: "Suspended",
      severity: "danger",
    };
  }

  if (
    subscription.status === "EXPIRED" ||
    subscription.accessMode === "READ_ONLY"
  ) {
    return {
      status: "READ_ONLY_OR_EXPIRED",
      label: "Expired or read-only",
      severity: "warning",
    };
  }

  const remaining = daysUntil(subscription.endDate);

  if (remaining !== null && remaining < 0) {
    return {
      status: "OVERDUE",
      label: "Past end date",
      severity: "danger",
    };
  }

  if (remaining !== null && remaining <= 7) {
    return {
      status: "RENEWAL_SOON",
      label: "Renewal due soon",
      severity: "warning",
    };
  }

  if (subscription.accessMode === "TRIAL") {
    return {
      status: "TRIAL",
      label: "Trial access",
      severity: "info",
    };
  }

  return {
    status: "ACTIVE",
    label: "Active",
    severity: "success",
  };
}

function buildSupportIssues(tenant) {
  const issues = [];

  const owner = tenant.users?.find((user) => user.role === UserRole.OWNER) || null;
  const activeUsers = tenant.users?.filter((user) => user.isActive !== false) || [];
  const activeLocations =
    tenant.branches?.filter((branch) => branch.status === "ACTIVE") || [];
  const mainLocation = tenant.branches?.find((branch) => branch.isMain) || null;

  if (!owner) {
    issues.push({
      code: "OWNER_MISSING",
      severity: "danger",
      title: "Missing owner account",
      message: "No owner account is linked to this business.",
      suggestedAction: "Repair the tenant owner account from the platform tenant detail screen.",
    });
  }

  if (activeUsers.length === 0) {
    issues.push({
      code: "NO_ACTIVE_TEAM_MEMBERS",
      severity: "danger",
      title: "No active team members",
      message: "This business has no active user account.",
      suggestedAction: "Check whether the owner account is missing, inactive, or incorrectly created.",
    });
  }

  if (!tenant.branches || tenant.branches.length === 0) {
    issues.push({
      code: "NO_STORE_LOCATIONS",
      severity: "danger",
      title: "No store locations",
      message: "This business has no store location record.",
      suggestedAction: "Create or repair the main store location.",
    });
  }

  if (tenant.branches?.length > 0 && !mainLocation) {
    issues.push({
      code: "MAIN_STORE_LOCATION_MISSING",
      severity: "warning",
      title: "Main store location missing",
      message: "Store locations exist, but none is marked as the main location.",
      suggestedAction: "Set one active store location as the main location.",
    });
  }

  if (activeLocations.length === 0) {
    issues.push({
      code: "NO_ACTIVE_STORE_LOCATION",
      severity: "danger",
      title: "No active store location",
      message: "This business has no active store location.",
      suggestedAction: "Reactivate or create an active store location.",
    });
  }

  if (!tenant.subscription) {
    issues.push({
      code: "SUBSCRIPTION_MISSING",
      severity: "danger",
      title: "Missing subscription",
      message: "No subscription record is linked to this business.",
      suggestedAction: "Repair or recreate the subscription record.",
    });
  } else {
    const health = subscriptionHealth(tenant.subscription);

    if (health.severity === "danger") {
      issues.push({
        code: `SUBSCRIPTION_${health.status}`,
        severity: "danger",
        title: health.label,
        message: "This business may be blocked or incorrectly allowed depending on subscription middleware state.",
        suggestedAction: "Review subscription status, access mode, and end date.",
      });
    }

    if (health.severity === "warning") {
      issues.push({
        code: `SUBSCRIPTION_${health.status}`,
        severity: "warning",
        title: health.label,
        message: "This business may need renewal or access review.",
        suggestedAction: "Check recent payments and subscription renewal state.",
      });
    }
  }

  if (tenant.status === "SUSPENDED") {
    issues.push({
      code: "TENANT_SUSPENDED",
      severity: "danger",
      title: "Business suspended",
      message: "This business is suspended at platform level.",
      suggestedAction: "Only platform owner/admin should reactivate it after review.",
    });
  }

  if (!tenant.onboardingCompleted) {
    issues.push({
      code: "ONBOARDING_NOT_COMPLETED",
      severity: "info",
      title: "Onboarding not completed",
      message: "This business has not completed onboarding.",
      suggestedAction: "Check whether the business owner stopped before finishing setup.",
    });
  }

  return issues;
}

function supportStatusFromIssues(issues) {
  if (issues.some((issue) => issue.severity === "danger")) return "NEEDS_ATTENTION";
  if (issues.some((issue) => issue.severity === "warning")) return "WATCH";
  return "HEALTHY";
}

function publicSupportBusiness(tenant) {
  const owner = tenant.users?.find((user) => user.role === UserRole.OWNER) || null;
  const issues = buildSupportIssues(tenant);

  return {
    id: tenant.id,
    name: tenant.name,
    email: tenant.email,
    phone: tenant.phone,
    status: tenant.status,
    platformStatus: tenant.status,
    createdAt: tenant.createdAt,

    businessProfile: businessProfile(tenant),

    owner,

    subscription: tenant.subscription
      ? {
          ...tenant.subscription,
          daysUntilEnd: daysUntil(tenant.subscription.endDate),
          health: subscriptionHealth(tenant.subscription),
        }
      : null,

    usage: {
      storeLocations: safeNumber(tenant._count?.branches),
      users: safeNumber(tenant._count?.users),
      customers: safeNumber(tenant._count?.customers),
      products: safeNumber(tenant._count?.products),
      sales: safeNumber(tenant._count?.sales),
      repairs: safeNumber(tenant._count?.repairs),
      expenses: safeNumber(tenant._count?.expenses),
      suppliers: safeNumber(tenant._count?.suppliers),
      auditLogs: safeNumber(tenant._count?.auditLogs),
    },

    storeLocations: tenant.branches || [],

    support: {
      status: supportStatusFromIssues(issues),
      issues,
      issueCount: issues.length,
      dangerCount: issues.filter((issue) => issue.severity === "danger").length,
      warningCount: issues.filter((issue) => issue.severity === "warning").length,
      infoCount: issues.filter((issue) => issue.severity === "info").length,
    },
  };
}

function auditLogSelect() {
  return {
    id: true,
    tenantId: true,
    branchId: true,
    userId: true,
    entityId: true,
    action: true,
    entity: true,
    metadata: true,
    createdAt: true,

    tenant: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
      },
    },

    branch: {
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        status: true,
        isMain: true,
      },
    },

    user: {
      select: {
        id: true,
        tenantId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
      },
    },
  };
}

function publicAuditLog(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    storeLocationId: row.branchId || null,
    userId: row.userId || null,
    entityId: row.entityId || null,
    action: row.action,
    entity: row.entity,
    metadata: row.metadata || null,
    createdAt: row.createdAt,

    business: row.tenant || null,
    storeLocation: row.branch || null,
    actor: row.user || null,
  };
}

async function getSupportOverview(req, res) {
  try {
    const now = new Date();

    const [
      tenants,
      users,
      storeLocations,
      missingOwnerBusinesses,
      noUserBusinesses,
      noLocationBusinesses,
      expiredSubscriptions,
      readOnlySubscriptions,
      suspendedSubscriptions,
      overdueSubscriptions,
      recentAuditLogs,
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.user.count(),
      prisma.branch.count(),

      prisma.tenant.count({
        where: {
          users: {
            none: { role: UserRole.OWNER },
          },
        },
      }),

      prisma.tenant.count({
        where: {
          users: {
            none: {},
          },
        },
      }),

      prisma.tenant.count({
        where: {
          branches: {
            none: {},
          },
        },
      }),

      prisma.subscription.count({
        where: { status: "EXPIRED" },
      }),

      prisma.subscription.count({
        where: { accessMode: "READ_ONLY" },
      }),

      prisma.subscription.count({
        where: {
          OR: [{ status: "SUSPENDED" }, { accessMode: "SUSPENDED" }],
        },
      }),

      prisma.subscription.count({
        where: {
          endDate: { lt: now },
          status: "ACTIVE",
          accessMode: { not: "READ_ONLY" },
        },
      }),

      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: auditLogSelect(),
      }),
    ]);

    return res.json({
      overview: {
        businesses: tenants,
        tenantUsers: users,
        storeLocations,

        supportQueue: {
          missingOwnerBusinesses,
          noUserBusinesses,
          noLocationBusinesses,
          expiredSubscriptions,
          readOnlySubscriptions,
          suspendedSubscriptions,
          overdueSubscriptions,
          totalAttention:
            missingOwnerBusinesses +
            noUserBusinesses +
            noLocationBusinesses +
            expiredSubscriptions +
            readOnlySubscriptions +
            suspendedSubscriptions +
            overdueSubscriptions,
        },

        recentActivity: recentAuditLogs.map(publicAuditLog),
      },
    });
  } catch (err) {
    console.error("getSupportOverview error:", err);
    return res.status(500).json({
      message: "Failed to load platform support overview",
      code: "PLATFORM_SUPPORT_OVERVIEW_FAILED",
    });
  }
}

async function searchBusinesses(req, res) {
  try {
    const q = String(req.query?.q || "").trim();
    const status = normalizeTenantStatus(req.query?.status);
    const subscriptionStatus = normalizeSubscriptionStatus(req.query?.subscriptionStatus);
    const accessMode = normalizeSubscriptionAccessMode(req.query?.accessMode);

    const issue = String(req.query?.issue || "").trim().toUpperCase();

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
              {
                users: {
                  some: {
                    OR: [
                      { name: { contains: q, mode: "insensitive" } },
                      { email: { contains: q, mode: "insensitive" } },
                      { phone: { contains: q, mode: "insensitive" } },
                    ],
                  },
                },
              },
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

      ...(issue === "OWNER_MISSING"
        ? {
            users: {
              none: { role: UserRole.OWNER },
            },
          }
        : {}),

      ...(issue === "NO_USERS"
        ? {
            users: {
              none: {},
            },
          }
        : {}),

      ...(issue === "NO_STORE_LOCATIONS"
        ? {
            branches: {
              none: {},
            },
          }
        : {}),

      ...(issue === "READ_ONLY"
        ? {
            subscription: {
              accessMode: "READ_ONLY",
            },
          }
        : {}),

      ...(issue === "SUSPENDED"
        ? {
            OR: [
              { status: "SUSPENDED" },
              { subscription: { status: "SUSPENDED" } },
              { subscription: { accessMode: "SUSPENDED" } },
            ],
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      prisma.tenant.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: tenantBaseSelect(),
      }),
      prisma.tenant.count({ where }),
    ]);

    const businesses = rows.map(publicSupportBusiness);

    return res.json({
      businesses,
      count,
      page: {
        skip,
        take,
        returned: businesses.length,
        hasMore: skip + businesses.length < count,
      },
    });
  } catch (err) {
    console.error("searchBusinesses error:", err);
    return res.status(500).json({
      message: "Failed to search support businesses",
      code: "PLATFORM_SUPPORT_BUSINESS_SEARCH_FAILED",
    });
  }
}

async function getBusinessSupportDetail(req, res) {
  const tenantId = cleanString(req.params?.tenantId);

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: tenantBaseSelect(),
    });

    if (!tenant) {
      return res.status(404).json({
        message: "Business not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    const [
      salesSummary,
      recentSales,
      recentPayments,
      recentAuditLogs,
      recentLoginEvents,
      recentPasswordEvents,
      recentExpenses,
      recentRepairs,
    ] = await Promise.all([
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
        take: 8,
        select: {
          id: true,
          branchId: true,
          customerId: true,
          cashierId: true,
          total: true,
          amountPaid: true,
          balanceDue: true,
          saleType: true,
          status: true,
          receiptNumber: true,
          invoiceNumber: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
              status: true,
              isMain: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          cashier: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),

      prisma.payment.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          tenantId: true,
          intentId: true,
          amount: true,
          currency: true,
          reference: true,
          status: true,
          provider: true,
          purpose: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
          branchLimit: true,
          priceAmount: true,
          createdAt: true,
          updatedAt: true,
        },
      }),

      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: auditLogSelect(),
      }),

      prisma.loginEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          tenantId: true,
          userId: true,
          email: true,
          role: true,
          status: true,
          method: true,
          ipAddress: true,
          userAgent: true,
          deviceLabel: true,
          reason: true,
          createdAt: true,
        },
      }),

      prisma.passwordChangeEvent.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          tenantId: true,
          userId: true,
          changedById: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),

      prisma.expense.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          title: true,
          category: true,
          amount: true,
          status: true,
          createdAt: true,
          approvedAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              isMain: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),

      prisma.repair.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          device: true,
          serial: true,
          issue: true,
          status: true,
          warrantyEnd: true,
          createdAt: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              isMain: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          technician: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    const business = publicSupportBusiness(tenant);

    return res.json({
      business,

      diagnostics: {
        supportStatus: business.support.status,
        issues: business.support.issues,
      },

      teamMembers: tenant.users || [],
      storeLocations: tenant.branches || [],

      salesSummary: {
        salesCount: salesSummary._count?._all || 0,
        totalSalesValue: safeNumber(salesSummary._sum?.total),
        totalPaid: safeNumber(salesSummary._sum?.amountPaid),
        totalOutstanding: safeNumber(salesSummary._sum?.balanceDue),
      },

      recentSales,
      recentPayments,
      recentAuditLogs: recentAuditLogs.map(publicAuditLog),
      recentLoginEvents,
      recentPasswordEvents,
      recentExpenses,
      recentRepairs,
    });
  } catch (err) {
    console.error("getBusinessSupportDetail error:", err);
    return res.status(500).json({
      message: "Failed to load business support detail",
      code: "PLATFORM_SUPPORT_BUSINESS_DETAIL_FAILED",
    });
  }
}

async function getBusinessAccountHealth(req, res) {
  const tenantId = cleanString(req.params?.tenantId);

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: tenantBaseSelect(),
    });

    if (!tenant) {
      return res.status(404).json({
        message: "Business not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    const business = publicSupportBusiness(tenant);

    return res.json({
      accountHealth: {
        tenantId,
        businessName: tenant.name,
        status: business.support.status,
        issues: business.support.issues,
        owner: business.owner,
        activeUserCount: tenant.users.filter((user) => user.isActive !== false).length,
        totalUserCount: tenant.users.length,
        activeStoreLocationCount: tenant.branches.filter((branch) => branch.status === "ACTIVE").length,
        totalStoreLocationCount: tenant.branches.length,
        subscription: business.subscription,
      },
    });
  } catch (err) {
    console.error("getBusinessAccountHealth error:", err);
    return res.status(500).json({
      message: "Failed to load account health",
      code: "PLATFORM_SUPPORT_ACCOUNT_HEALTH_FAILED",
    });
  }
}

async function getBusinessActivity(req, res) {
  const tenantId = cleanString(req.params?.tenantId);

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  try {
    const takeRaw = Number(req.query?.take || 30);
    const skipRaw = Number(req.query?.skip || 0);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 30;
    const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

    const [logs, count] = await Promise.all([
      prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: auditLogSelect(),
      }),
      prisma.auditLog.count({ where: { tenantId } }),
    ]);

    return res.json({
      activity: logs.map(publicAuditLog),
      count,
      page: {
        skip,
        take,
        returned: logs.length,
        hasMore: skip + logs.length < count,
      },
    });
  } catch (err) {
    console.error("getBusinessActivity error:", err);
    return res.status(500).json({
      message: "Failed to load business activity",
      code: "PLATFORM_SUPPORT_ACTIVITY_FAILED",
    });
  }
}

module.exports = {
  getSupportOverview,
  searchBusinesses,
  getBusinessSupportDetail,
  getBusinessAccountHealth,
  getBusinessActivity,
};