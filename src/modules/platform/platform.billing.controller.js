const prisma = require("../../config/database");
const {
  SubscriptionAccessMode,
  SubscriptionStatus,
  PaymentStatus,
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

function normalizePaymentStatus(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(PaymentStatus).includes(raw) ? raw : null;
}

function getPlatformUser(req) {
  return req.platformUser || req.user || null;
}

function getPlatformRole(req) {
  return String(getPlatformUser(req)?.role || "").toUpperCase();
}

function canControlBilling(req) {
  const role = getPlatformRole(req);
  return role === "PLATFORM_OWNER" || role === "PLATFORM_ADMIN";
}

function tenantLiteSelect() {
  return {
    id: true,
    name: true,
    email: true,
    phone: true,
    status: true,
    shopType: true,
    district: true,
    sector: true,
    address: true,
    createdAt: true,
  };
}

function subscriptionSelect() {
  return {
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

    trialConsumed: true,
    trialSourceIntentId: true,
    nextPlanKey: true,

    tenant: {
      select: tenantLiteSelect(),
    },
  };
}

function paymentSelect() {
  return {
    id: true,
    intentId: true,
    tenantId: true,
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

    tenant: {
      select: tenantLiteSelect(),
    },

    intent: {
      select: {
        id: true,
        ownerName: true,
        storeName: true,
        email: true,
        phone: true,
        status: true,
        requestedPlanKey: true,
        requestedTierKey: true,
        requestedCycleKey: true,
        requestedPriceAmount: true,
        requestedCurrency: true,
        createdAt: true,
        convertedAt: true,
      },
    },
  };
}

function daysUntil(dateValue) {
  const d = toDateOrNull(dateValue);
  if (!d) return null;

  const now = new Date();
  const ms = d.getTime() - now.getTime();
  return Math.ceil(ms / 86400000);
}

function billingHealthForSubscription(subscription) {
  if (!subscription) {
    return {
      status: "NEEDS_ATTENTION",
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

  const days = daysUntil(subscription.endDate);

  if (days != null && days < 0) {
    return {
      status: "OVERDUE",
      label: "Past end date",
      severity: "danger",
    };
  }

  if (days != null && days <= 7) {
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
    status: "HEALTHY",
    label: "Active",
    severity: "success",
  };
}

function publicSubscriptionRow(subscription) {
  const health = billingHealthForSubscription(subscription);

  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    status: subscription.status,
    accessMode: subscription.accessMode,

    plan: {
      planKey: subscription.planKey || null,
      tierKey: subscription.tierKey || null,
      cycleKey: subscription.cycleKey || null,
      staffLimit: subscription.staffLimit ?? null,
      branchLimit: subscription.branchLimit ?? null,
      extraBranchCount: subscription.extraBranchCount ?? 0,
      priceAmount: subscription.priceAmount ?? null,
      currency: subscription.currency || null,
      nextPlanKey: subscription.nextPlanKey || null,
    },

    timeline: {
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      trialStartDate: subscription.trialStartDate,
      trialEndDate: subscription.trialEndDate,
      graceEndDate: subscription.graceEndDate,
      readOnlySince: subscription.readOnlySince,
      lastPaymentAt: subscription.lastPaymentAt,
      renewedAt: subscription.renewedAt,
      createdAt: subscription.createdAt,
      daysUntilEnd: daysUntil(subscription.endDate),
    },

    trial: {
      trialConsumed: Boolean(subscription.trialConsumed),
      trialSourceIntentId: subscription.trialSourceIntentId || null,
    },

    health,

    business: subscription.tenant
      ? {
          id: subscription.tenant.id,
          name: subscription.tenant.name,
          email: subscription.tenant.email,
          phone: subscription.tenant.phone,
          status: subscription.tenant.status,
          shopType: subscription.tenant.shopType || null,
          district: subscription.tenant.district || null,
          sector: subscription.tenant.sector || null,
          address: subscription.tenant.address || null,
          createdAt: subscription.tenant.createdAt,
        }
      : null,
  };
}

function publicPaymentRow(payment) {
  return {
    id: payment.id,
    tenantId: payment.tenantId || null,
    intentId: payment.intentId || null,
    amount: safeNumber(payment.amount),
    currency: payment.currency || "RWF",
    reference: payment.reference,
    status: payment.status,
    provider: payment.provider,
    purpose: payment.purpose,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,

    plan: {
      planKey: payment.planKey || null,
      tierKey: payment.tierKey || null,
      cycleKey: payment.cycleKey || null,
      staffLimit: payment.staffLimit ?? null,
      branchLimit: payment.branchLimit ?? null,
      priceAmount: payment.priceAmount ?? null,
    },

    business: payment.tenant
      ? {
          id: payment.tenant.id,
          name: payment.tenant.name,
          email: payment.tenant.email,
          phone: payment.tenant.phone,
          status: payment.tenant.status,
          shopType: payment.tenant.shopType || null,
          district: payment.tenant.district || null,
          sector: payment.tenant.sector || null,
          address: payment.tenant.address || null,
          createdAt: payment.tenant.createdAt,
        }
      : null,

    signupIntent: payment.intent
      ? {
          id: payment.intent.id,
          ownerName: payment.intent.ownerName,
          storeName: payment.intent.storeName,
          email: payment.intent.email,
          phone: payment.intent.phone,
          status: payment.intent.status,
          requestedPlanKey: payment.intent.requestedPlanKey,
          requestedTierKey: payment.intent.requestedTierKey,
          requestedCycleKey: payment.intent.requestedCycleKey,
          requestedPriceAmount: payment.intent.requestedPriceAmount,
          requestedCurrency: payment.intent.requestedCurrency,
          createdAt: payment.intent.createdAt,
          convertedAt: payment.intent.convertedAt,
        }
      : null,
  };
}

function dateRangeWhere(req) {
  const from = toDateOrNull(req.query?.from);
  const to = toDateOrNull(req.query?.to);

  if (!from && !to) return {};

  return {
    createdAt: {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    },
  };
}

async function getBillingOverview(req, res) {
  try {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86400000);
    const in30Days = new Date(now.getTime() + 30 * 86400000);

    const [
      totalSubscriptions,
      activeSubscriptions,
      trialSubscriptions,
      readOnlySubscriptions,
      suspendedSubscriptions,
      expiredSubscriptions,
      renewalsDue7Days,
      renewalsDue30Days,

      totalPayments,
      successfulPayments,
      pendingPayments,
      failedPayments,

      successfulAmountAgg,
      pendingAmountAgg,
      failedAmountAgg,

      recentSuccessfulPayments,
    ] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { accessMode: "TRIAL" } }),
      prisma.subscription.count({ where: { accessMode: "READ_ONLY" } }),
      prisma.subscription.count({
        where: {
          OR: [{ status: "SUSPENDED" }, { accessMode: "SUSPENDED" }],
        },
      }),
      prisma.subscription.count({ where: { status: "EXPIRED" } }),
      prisma.subscription.count({
        where: {
          endDate: {
            gte: now,
            lte: in7Days,
          },
        },
      }),
      prisma.subscription.count({
        where: {
          endDate: {
            gte: now,
            lte: in30Days,
          },
        },
      }),

      prisma.payment.count(),
      prisma.payment.count({ where: { status: "SUCCESS" } }),
      prisma.payment.count({ where: { status: "PENDING" } }),
      prisma.payment.count({ where: { status: "FAILED" } }),

      prisma.payment.aggregate({
        where: { status: "SUCCESS" },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { status: "FAILED" },
        _sum: { amount: true },
      }),

      prisma.payment.findMany({
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: paymentSelect(),
      }),
    ]);

    return res.json({
      overview: {
        subscriptions: {
          total: totalSubscriptions,
          active: activeSubscriptions,
          trial: trialSubscriptions,
          readOnly: readOnlySubscriptions,
          suspended: suspendedSubscriptions,
          expired: expiredSubscriptions,
          renewalsDue7Days,
          renewalsDue30Days,
        },
        payments: {
          total: totalPayments,
          successful: successfulPayments,
          pending: pendingPayments,
          failed: failedPayments,
          successfulAmount: safeNumber(successfulAmountAgg._sum?.amount),
          pendingAmount: safeNumber(pendingAmountAgg._sum?.amount),
          failedAmount: safeNumber(failedAmountAgg._sum?.amount),
        },
        recentSuccessfulPayments: recentSuccessfulPayments.map(publicPaymentRow),
      },
    });
  } catch (err) {
    console.error("getBillingOverview error:", err);
    return res.status(500).json({
      message: "Failed to load platform billing overview",
      code: "PLATFORM_BILLING_OVERVIEW_FAILED",
    });
  }
}

async function listSubscriptions(req, res) {
  try {
    const q = String(req.query?.q || "").trim();
    const status = normalizeSubscriptionStatus(req.query?.status);
    const accessMode = normalizeSubscriptionAccessMode(req.query?.accessMode);
    const tenantId = cleanString(req.query?.tenantId);

    const renewalWindow = String(req.query?.renewalWindow || "")
      .trim()
      .toLowerCase();

    const takeRaw = Number(req.query?.take || 50);
    const skipRaw = Number(req.query?.skip || 0);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;
    const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

    const now = new Date();
    const renewalEnd =
      renewalWindow === "7d"
        ? new Date(now.getTime() + 7 * 86400000)
        : renewalWindow === "30d"
          ? new Date(now.getTime() + 30 * 86400000)
          : null;

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(status ? { status } : {}),
      ...(accessMode ? { accessMode } : {}),
      ...(renewalEnd
        ? {
            endDate: {
              gte: now,
              lte: renewalEnd,
            },
          }
        : {}),
      ...(q
        ? {
            tenant: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
                { shopType: { contains: q, mode: "insensitive" } },
                { district: { contains: q, mode: "insensitive" } },
                { sector: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      prisma.subscription.findMany({
        where,
        orderBy: [{ endDate: "asc" }, { createdAt: "desc" }],
        skip,
        take,
        select: subscriptionSelect(),
      }),
      prisma.subscription.count({ where }),
    ]);

    const subscriptions = rows.map(publicSubscriptionRow);

    return res.json({
      subscriptions,
      count,
      page: {
        skip,
        take,
        returned: subscriptions.length,
        hasMore: skip + subscriptions.length < count,
      },
    });
  } catch (err) {
    console.error("listSubscriptions error:", err);
    return res.status(500).json({
      message: "Failed to load subscriptions",
      code: "PLATFORM_SUBSCRIPTIONS_LIST_FAILED",
    });
  }
}

async function getSubscriptionByTenant(req, res) {
  const tenantId = cleanString(req.params?.tenantId);

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  try {
    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
      select: subscriptionSelect(),
    });

    if (!subscription) {
      return res.status(404).json({
        message: "Subscription not found for this business",
        code: "SUBSCRIPTION_NOT_FOUND",
      });
    }

    const [payments, paymentAgg] = await Promise.all([
      prisma.payment.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: paymentSelect(),
      }),
      prisma.payment.aggregate({
        where: {
          tenantId,
          status: "SUCCESS",
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    return res.json({
      subscription: publicSubscriptionRow(subscription),
      paymentSummary: {
        successfulPayments: paymentAgg._count?._all || 0,
        successfulAmount: safeNumber(paymentAgg._sum?.amount),
      },
      recentPayments: payments.map(publicPaymentRow),
    });
  } catch (err) {
    console.error("getSubscriptionByTenant error:", err);
    return res.status(500).json({
      message: "Failed to load subscription detail",
      code: "PLATFORM_SUBSCRIPTION_DETAIL_FAILED",
    });
  }
}

async function listPayments(req, res) {
  try {
    const q = String(req.query?.q || "").trim();
    const status = normalizePaymentStatus(req.query?.status);
    const tenantId = cleanString(req.query?.tenantId);
    const provider = cleanString(req.query?.provider);
    const purpose = cleanString(req.query?.purpose);

    const takeRaw = Number(req.query?.take || 50);
    const skipRaw = Number(req.query?.skip || 0);
    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;
    const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

    const where = {
      ...(tenantId ? { tenantId } : {}),
      ...(status ? { status } : {}),
      ...(provider ? { provider: { contains: provider, mode: "insensitive" } } : {}),
      ...(purpose ? { purpose: { contains: purpose, mode: "insensitive" } } : {}),
      ...dateRangeWhere(req),
      ...(q
        ? {
            OR: [
              { reference: { contains: q, mode: "insensitive" } },
              { provider: { contains: q, mode: "insensitive" } },
              { purpose: { contains: q, mode: "insensitive" } },
              { planKey: { contains: q, mode: "insensitive" } },
              { tierKey: { contains: q, mode: "insensitive" } },
              { cycleKey: { contains: q, mode: "insensitive" } },
              {
                tenant: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                    { phone: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
              {
                intent: {
                  OR: [
                    { ownerName: { contains: q, mode: "insensitive" } },
                    { storeName: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                    { phone: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [rows, count, amountAgg] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: paymentSelect(),
      }),
      prisma.payment.count({ where }),
      prisma.payment.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    const payments = rows.map(publicPaymentRow);

    return res.json({
      payments,
      count,
      totalAmount: safeNumber(amountAgg._sum?.amount),
      page: {
        skip,
        take,
        returned: payments.length,
        hasMore: skip + payments.length < count,
      },
    });
  } catch (err) {
    console.error("listPayments error:", err);
    return res.status(500).json({
      message: "Failed to load platform payments",
      code: "PLATFORM_PAYMENTS_LIST_FAILED",
    });
  }
}

async function getPaymentById(req, res) {
  const id = cleanString(req.params?.id);

  if (!id) {
    return res.status(400).json({
      message: "Payment id is required",
      code: "PAYMENT_ID_REQUIRED",
    });
  }

  try {
    const payment = await prisma.payment.findUnique({
      where: { id },
      select: paymentSelect(),
    });

    if (!payment) {
      return res.status(404).json({
        message: "Payment not found",
        code: "PAYMENT_NOT_FOUND",
      });
    }

    return res.json({
      payment: publicPaymentRow(payment),
    });
  } catch (err) {
    console.error("getPaymentById error:", err);
    return res.status(500).json({
      message: "Failed to load payment detail",
      code: "PLATFORM_PAYMENT_DETAIL_FAILED",
    });
  }
}

async function updateSubscriptionAccess(req, res) {
  const tenantId = cleanString(req.params?.tenantId);
  const accessMode = normalizeSubscriptionAccessMode(req.body?.accessMode);
  const status =
    req.body?.status === undefined
      ? null
      : normalizeSubscriptionStatus(req.body?.status);

  if (!canControlBilling(req)) {
    return res.status(403).json({
      message: "Only platform owner or platform admin can update billing access",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  if (!accessMode) {
    return res.status(400).json({
      message: `accessMode must be one of ${Object.values(SubscriptionAccessMode).join(", ")}`,
      code: "INVALID_SUBSCRIPTION_ACCESS_MODE",
    });
  }

  if (req.body?.status !== undefined && !status) {
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
        message: "Subscription not found for this business",
        code: "SUBSCRIPTION_NOT_FOUND",
      });
    }

    const updated = await prisma.subscription.update({
      where: { tenantId },
      data: {
        accessMode,
        ...(status ? { status } : {}),
        ...(accessMode === "READ_ONLY" ? { readOnlySince: new Date() } : {}),
        ...(accessMode !== "READ_ONLY" ? { readOnlySince: null } : {}),
      },
      select: subscriptionSelect(),
    });

    return res.json({
      message: "Subscription access updated",
      subscription: publicSubscriptionRow(updated),
    });
  } catch (err) {
    console.error("updateSubscriptionAccess error:", err);
    return res.status(500).json({
      message: "Failed to update subscription access",
      code: "PLATFORM_SUBSCRIPTION_ACCESS_UPDATE_FAILED",
    });
  }
}

async function renewSubscription(req, res) {
  const tenantId = cleanString(req.params?.tenantId);

  const planKey = cleanString(req.body?.planKey);
  const tierKey = cleanString(req.body?.tierKey);
  const cycleKey = cleanString(req.body?.cycleKey);
  const currency = cleanString(req.body?.currency) || "RWF";

  const staffLimit =
    req.body?.staffLimit === undefined || req.body?.staffLimit === null
      ? null
      : Number(req.body.staffLimit);

  const branchLimit =
    req.body?.branchLimit === undefined || req.body?.branchLimit === null
      ? null
      : Number(req.body.branchLimit);

  const extraBranchCount =
    req.body?.extraBranchCount === undefined || req.body?.extraBranchCount === null
      ? 0
      : Number(req.body.extraBranchCount);

  const priceAmount =
    req.body?.priceAmount === undefined || req.body?.priceAmount === null
      ? null
      : Number(req.body.priceAmount);

  const startDate = toDateOrNull(req.body?.startDate) || new Date();
  const endDate = toDateOrNull(req.body?.endDate);
  const graceEndDate = toDateOrNull(req.body?.graceEndDate);

  if (!canControlBilling(req)) {
    return res.status(403).json({
      message: "Only platform owner or platform admin can renew subscriptions",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  if (!tenantId) {
    return res.status(400).json({
      message: "Tenant id is required",
      code: "TENANT_ID_REQUIRED",
    });
  }

  if (!planKey) {
    return res.status(400).json({
      message: "planKey is required",
      code: "PLAN_KEY_REQUIRED",
    });
  }

  if (!endDate) {
    return res.status(400).json({
      message: "Valid endDate is required",
      code: "END_DATE_REQUIRED",
    });
  }

  if (endDate.getTime() <= startDate.getTime()) {
    return res.status(400).json({
      message: "endDate must be after startDate",
      code: "INVALID_RENEWAL_DATES",
    });
  }

  if (staffLimit !== null && (!Number.isInteger(staffLimit) || staffLimit < 1)) {
    return res.status(400).json({
      message: "staffLimit must be a positive whole number",
      code: "INVALID_STAFF_LIMIT",
    });
  }

  if (branchLimit !== null && (!Number.isInteger(branchLimit) || branchLimit < 1)) {
    return res.status(400).json({
      message: "branchLimit must be a positive whole number",
      code: "INVALID_BRANCH_LIMIT",
    });
  }

  if (!Number.isInteger(extraBranchCount) || extraBranchCount < 0) {
    return res.status(400).json({
      message: "extraBranchCount must be zero or a positive whole number",
      code: "INVALID_EXTRA_BRANCH_COUNT",
    });
  }

  if (priceAmount !== null && (!Number.isFinite(priceAmount) || priceAmount < 0)) {
    return res.status(400).json({
      message: "priceAmount must be zero or a positive number",
      code: "INVALID_PRICE_AMOUNT",
    });
  }

  try {
    const existingTenant = await prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { id: true, name: true },
    });

    if (!existingTenant) {
      return res.status(404).json({
        message: "Tenant not found",
        code: "TENANT_NOT_FOUND",
      });
    }

    const updated = await prisma.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        status: "ACTIVE",
        accessMode: "ACTIVE",
        planKey,
        tierKey,
        cycleKey,
        staffLimit,
        branchLimit,
        extraBranchCount,
        priceAmount,
        currency,
        startDate,
        endDate,
        graceEndDate,
        lastPaymentAt: priceAmount !== null ? new Date() : null,
        renewedAt: new Date(),
        trialConsumed: true,
      },
      update: {
        status: "ACTIVE",
        accessMode: "ACTIVE",
        planKey,
        tierKey,
        cycleKey,
        staffLimit,
        branchLimit,
        extraBranchCount,
        priceAmount,
        currency,
        startDate,
        endDate,
        graceEndDate,
        readOnlySince: null,
        lastPaymentAt: priceAmount !== null ? new Date() : undefined,
        renewedAt: new Date(),
        trialConsumed: true,
      },
      select: subscriptionSelect(),
    });

    return res.json({
      message: "Subscription renewed",
      subscription: publicSubscriptionRow(updated),
    });
  } catch (err) {
    console.error("renewSubscription error:", err);
    return res.status(500).json({
      message: "Failed to renew subscription",
      code: "PLATFORM_SUBSCRIPTION_RENEW_FAILED",
    });
  }
}

module.exports = {
  getBillingOverview,
  listSubscriptions,
  getSubscriptionByTenant,
  listPayments,
  getPaymentById,
  updateSubscriptionAccess,
  renewSubscription,
};