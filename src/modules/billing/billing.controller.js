// src/modules/billing/billing.controller.js
const crypto = require("crypto");
const prisma = require("../../config/database");

const {
  getGraceDays,
  getPaidPlans,
  getPlanByKey,
  getPlanSnapshot,
  isTrialPlanKey,
  isEnterprisePlanKey,
} = require("../../config/plans");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeTenantId(req) {
  return (
    cleanString(req.user?.tenantId) ||
    cleanString(req.params?.tenantId) ||
    cleanString(req.body?.tenantId) ||
    cleanString(req.query?.tenantId) ||
    null
  );
}

function resolveProvider(value) {
  const v = String(value || "MOMO").trim().toUpperCase();
  if (v === "MOMO" || v === "BANK" || v === "CARD" || v === "CASH" || v === "OTHER") {
    return v;
  }
  return "MOMO";
}

function makeReference(prefix = "RENEW") {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}_${ts}_${rand}`;
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function toIsoDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function serializeSubscription(subscription, activeUsersCount = null) {
  if (!subscription) return null;

  const staffLimit = Number.isFinite(Number(subscription.staffLimit))
    ? Number(subscription.staffLimit)
    : null;

  const activeUsers =
    Number.isFinite(Number(activeUsersCount)) && Number(activeUsersCount) >= 0
      ? Number(activeUsersCount)
      : null;

  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    status: subscription.status,
    accessMode: subscription.accessMode,
    planKey: subscription.planKey || null,
    tierKey: subscription.tierKey || null,
    cycleKey: subscription.cycleKey || null,
    staffLimit,
    priceAmount: Number.isFinite(Number(subscription.priceAmount))
      ? Number(subscription.priceAmount)
      : null,
    currency: subscription.currency || null,
    startDate: toIsoDate(subscription.startDate),
    endDate: toIsoDate(subscription.endDate),
    trialStartDate: toIsoDate(subscription.trialStartDate),
    trialEndDate: toIsoDate(subscription.trialEndDate),
    graceEndDate: toIsoDate(subscription.graceEndDate),
    readOnlySince: toIsoDate(subscription.readOnlySince),
    lastPaymentAt: toIsoDate(subscription.lastPaymentAt),
    renewedAt: toIsoDate(subscription.renewedAt),
    trialConsumed: Boolean(subscription.trialConsumed),
    trialSourceIntentId: subscription.trialSourceIntentId || null,
    nextPlanKey: subscription.nextPlanKey || null,
    createdAt: toIsoDate(subscription.createdAt),
    activeUsers,
    overLimit:
      staffLimit != null && activeUsers != null ? Number(activeUsers) > Number(staffLimit) : false,
  };
}

async function countActiveBillableUsers(tenantId) {
  return prisma.user.count({
    where: {
      tenantId,
      isActive: true,
      role: {
        in: ["OWNER", "MANAGER", "CASHIER", "SELLER", "STOREKEEPER", "TECHNICIAN"],
      },
    },
  });
}

async function getTenantOrThrow(tenantId) {
  const tenant = await prisma.tenant.findUnique({
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
    const err = new Error("Tenant not found");
    err.status = 404;
    throw err;
  }

  return tenant;
}

async function getSubscriptionOrThrow(tenantId) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      accessMode: true,
      planKey: true,
      tierKey: true,
      cycleKey: true,
      staffLimit: true,
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
      trialConsumed: true,
      trialSourceIntentId: true,
      nextPlanKey: true,
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

function resolveRenewalStartDate(subscription) {
  const now = new Date();
  const endDate = subscription?.endDate ? new Date(subscription.endDate) : null;

  if (endDate && !Number.isNaN(endDate.getTime()) && endDate > now) {
    return endDate;
  }

  return now;
}

function assertRenewalPlanOrThrow(planKey) {
  const plan = getPlanByKey(planKey);

  if (!plan) {
    const err = new Error("Invalid renewal plan");
    err.status = 400;
    throw err;
  }

  if (isTrialPlanKey(plan.key)) {
    const err = new Error("Trial plan cannot be used for renewal");
    err.status = 400;
    throw err;
  }

  if (isEnterprisePlanKey(plan.key)) {
    const err = new Error("Enterprise renewals require manual handling");
    err.status = 400;
    throw err;
  }

  return plan;
}

async function listBillingPlans(req, res) {
  try {
    const plans = getPaidPlans().map((p) => ({
      key: p.key,
      label: p.label,
      tierKey: p.tierKey,
      tierLabel: p.tierLabel,
      cycleKey: p.cycleKey,
      cycleLabel: p.cycleLabel,
      staffLimit: p.staffLimit,
      days: p.days,
      price: p.price,
      currency: p.currency,
      isEnterprise: Boolean(p.isEnterprise),
    }));

    return res.json({ plans });
  } catch (err) {
    console.error("listBillingPlans error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

async function getBillingOverview(req, res) {
  try {
    const tenantId = normalizeTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    const [tenant, subscription, activeUsers, recentPayments] = await Promise.all([
      getTenantOrThrow(tenantId),
      getSubscriptionOrThrow(tenantId),
      countActiveBillableUsers(tenantId),
      prisma.payment.findMany({
        where: {
          tenantId,
          purpose: {
            in: ["SUBSCRIPTION_RENEWAL", "OWNER_SIGNUP"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          amount: true,
          currency: true,
          reference: true,
          status: true,
          provider: true,
          purpose: true,
          createdAt: true,
          updatedAt: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
          priceAmount: true,
        },
      }),
    ]);

    return res.json({
      tenant,
      subscription: serializeSubscription(subscription, activeUsers),
      usage: {
        activeStaff: activeUsers,
        staffLimit: subscription.staffLimit ?? null,
        overLimit:
          subscription.staffLimit != null
            ? Number(activeUsers) > Number(subscription.staffLimit)
            : false,
      },
      payments: recentPayments.map((p) => ({
        id: p.id,
        amount: Number.isFinite(Number(p.amount)) ? Number(p.amount) : null,
        currency: p.currency || null,
        reference: p.reference,
        status: p.status,
        provider: p.provider,
        purpose: p.purpose,
        createdAt: toIsoDate(p.createdAt),
        updatedAt: toIsoDate(p.updatedAt),
        planKey: p.planKey || null,
        tierKey: p.tierKey || null,
        cycleKey: p.cycleKey || null,
        staffLimit: Number.isFinite(Number(p.staffLimit)) ? Number(p.staffLimit) : null,
        priceAmount: Number.isFinite(Number(p.priceAmount)) ? Number(p.priceAmount) : null,
      })),
    });
  } catch (err) {
    console.error("getBillingOverview error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
}

async function initiateRenewalPayment(req, res) {
  try {
    const tenantId = normalizeTenantId(req);
    const requestedPlanKey = cleanString(req.body.planKey);
    const provider = resolveProvider(req.body.provider);
    const externalReference = cleanString(req.body.reference);

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    if (!requestedPlanKey) {
      return res.status(400).json({ message: "planKey is required" });
    }

    const [tenant, subscription] = await Promise.all([
      getTenantOrThrow(tenantId),
      getSubscriptionOrThrow(tenantId),
    ]);

    const plan = assertRenewalPlanOrThrow(requestedPlanKey);
    const snap = getPlanSnapshot(plan.key);
    const reference = externalReference || makeReference("RENEW");

    const payment = await prisma.payment.upsert({
      where: { reference },
      update: {
        tenantId,
        amount: snap.price,
        currency: snap.currency,
        provider,
        status: "PENDING",
        purpose: "SUBSCRIPTION_RENEWAL",
        planKey: snap.planKey,
        tierKey: snap.tierKey,
        cycleKey: snap.cycleKey,
        staffLimit: snap.staffLimit,
        priceAmount: snap.price,
      },
      create: {
        tenantId,
        amount: snap.price,
        currency: snap.currency,
        reference,
        provider,
        status: "PENDING",
        purpose: "SUBSCRIPTION_RENEWAL",
        planKey: snap.planKey,
        tierKey: snap.tierKey,
        cycleKey: snap.cycleKey,
        staffLimit: snap.staffLimit,
        priceAmount: snap.price,
      },
      select: {
        id: true,
        tenantId: true,
        amount: true,
        currency: true,
        reference: true,
        status: true,
        provider: true,
        purpose: true,
        createdAt: true,
        updatedAt: true,
        planKey: true,
        tierKey: true,
        cycleKey: true,
        staffLimit: true,
        priceAmount: true,
      },
    });

    return res.status(201).json({
      message: "Renewal payment initiated",
      tenant,
      currentSubscription: serializeSubscription(subscription),
      payment,
      plan: snap,
    });
  } catch (err) {
    console.error("initiateRenewalPayment error:", err);
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Renewal initiation failed" });
  }
}

async function devMarkRenewalPaymentSuccessful(req, res) {
  try {
    const reference = cleanString(req.body.reference);
    const provider = resolveProvider(req.body.provider || "MOMO");

    if (!reference) {
      return res.status(400).json({ message: "reference is required" });
    }

    const payment = await prisma.payment.findUnique({
      where: { reference },
      select: {
        id: true,
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
        priceAmount: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (payment.purpose !== "SUBSCRIPTION_RENEWAL") {
      return res.status(400).json({ message: "This payment is not a renewal payment" });
    }

    if (!payment.tenantId) {
      return res.status(400).json({ message: "Renewal payment is missing tenantId" });
    }

    const [tenant, currentSubscription] = await Promise.all([
      getTenantOrThrow(payment.tenantId),
      getSubscriptionOrThrow(payment.tenantId),
    ]);

    const effectivePlanKey = cleanString(payment.planKey);
    if (!effectivePlanKey) {
      return res.status(400).json({ message: "Renewal payment is missing planKey" });
    }

    const plan = assertRenewalPlanOrThrow(effectivePlanKey);
    const snap = getPlanSnapshot(plan.key);

    const renewalStart = resolveRenewalStartDate(currentSubscription);
    const newEndDate = addDays(renewalStart, snap.days);
    const graceEndDate = addDays(newEndDate, getGraceDays());
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updatedPayment = await tx.payment.update({
        where: { reference },
        data: {
          provider,
          status: "SUCCESS",
          amount: snap.price,
          currency: snap.currency,
          planKey: snap.planKey,
          tierKey: snap.tierKey,
          cycleKey: snap.cycleKey,
          staffLimit: snap.staffLimit,
          priceAmount: snap.price,
        },
        select: {
          id: true,
          tenantId: true,
          amount: true,
          currency: true,
          reference: true,
          status: true,
          provider: true,
          purpose: true,
          createdAt: true,
          updatedAt: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
          priceAmount: true,
        },
      });

      const updatedSubscription = await tx.subscription.update({
        where: { tenantId: payment.tenantId },
        data: {
          status: "ACTIVE",
          accessMode: "ACTIVE",
          planKey: snap.planKey,
          tierKey: snap.tierKey,
          cycleKey: snap.cycleKey,
          staffLimit: snap.staffLimit,
          priceAmount: snap.price,
          currency: snap.currency,
          startDate: renewalStart,
          endDate: newEndDate,
          graceEndDate,
          readOnlySince: null,
          lastPaymentAt: now,
          renewedAt: now,
          nextPlanKey: null,
        },
        select: {
          id: true,
          tenantId: true,
          status: true,
          accessMode: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
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
          trialConsumed: true,
          trialSourceIntentId: true,
          nextPlanKey: true,
          createdAt: true,
        },
      });

      return { payment: updatedPayment, subscription: updatedSubscription };
    });

    const activeUsers = await countActiveBillableUsers(payment.tenantId);

    return res.json({
      message: "Renewal payment marked successful",
      tenant,
      payment: {
        id: result.payment.id,
        tenantId: result.payment.tenantId,
        amount: Number(result.payment.amount),
        currency: result.payment.currency,
        reference: result.payment.reference,
        status: result.payment.status,
        provider: result.payment.provider,
        purpose: result.payment.purpose,
        createdAt: toIsoDate(result.payment.createdAt),
        updatedAt: toIsoDate(result.payment.updatedAt),
        planKey: result.payment.planKey || null,
        tierKey: result.payment.tierKey || null,
        cycleKey: result.payment.cycleKey || null,
        staffLimit: Number.isFinite(Number(result.payment.staffLimit))
          ? Number(result.payment.staffLimit)
          : null,
        priceAmount: Number.isFinite(Number(result.payment.priceAmount))
          ? Number(result.payment.priceAmount)
          : null,
      },
      subscription: serializeSubscription(result.subscription, activeUsers),
      usage: {
        activeStaff: activeUsers,
        staffLimit: result.subscription.staffLimit ?? null,
        overLimit:
          result.subscription.staffLimit != null
            ? Number(activeUsers) > Number(result.subscription.staffLimit)
            : false,
      },
    });
  } catch (err) {
    console.error("devMarkRenewalPaymentSuccessful error:", err);
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Failed to mark renewal successful" });
  }
}

async function getRenewalPaymentStatus(req, res) {
  try {
    const reference = cleanString(req.params.reference || req.query.reference || req.body.reference);

    if (!reference) {
      return res.status(400).json({ message: "reference is required" });
    }

    const payment = await prisma.payment.findUnique({
      where: { reference },
      select: {
        id: true,
        tenantId: true,
        amount: true,
        currency: true,
        reference: true,
        status: true,
        provider: true,
        purpose: true,
        createdAt: true,
        updatedAt: true,
        planKey: true,
        tierKey: true,
        cycleKey: true,
        staffLimit: true,
        priceAmount: true,
      },
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    return res.json({
      payment: {
        id: payment.id,
        tenantId: payment.tenantId,
        amount: Number.isFinite(Number(payment.amount)) ? Number(payment.amount) : null,
        currency: payment.currency || null,
        reference: payment.reference,
        status: payment.status,
        provider: payment.provider,
        purpose: payment.purpose,
        createdAt: toIsoDate(payment.createdAt),
        updatedAt: toIsoDate(payment.updatedAt),
        planKey: payment.planKey || null,
        tierKey: payment.tierKey || null,
        cycleKey: payment.cycleKey || null,
        staffLimit: Number.isFinite(Number(payment.staffLimit)) ? Number(payment.staffLimit) : null,
        priceAmount: Number.isFinite(Number(payment.priceAmount))
          ? Number(payment.priceAmount)
          : null,
      },
    });
  } catch (err) {
    console.error("getRenewalPaymentStatus error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Future-safe helper endpoint:
 * returns whether the tenant is over its paid seat limit.
 * This does not block users by itself; enforcement should happen in user create/activate flows.
 */
async function getBillingUsage(req, res) {
  try {
    const tenantId = normalizeTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ message: "tenantId is required" });
    }

    const [subscription, activeUsers] = await Promise.all([
      getSubscriptionOrThrow(tenantId),
      countActiveBillableUsers(tenantId),
    ]);

    const staffLimit = Number.isFinite(Number(subscription.staffLimit))
      ? Number(subscription.staffLimit)
      : null;

    return res.json({
      tenantId,
      activeStaff: activeUsers,
      staffLimit,
      overLimit: staffLimit != null ? Number(activeUsers) > Number(staffLimit) : false,
      subscription: serializeSubscription(subscription, activeUsers),
    });
  } catch (err) {
    console.error("getBillingUsage error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
}

module.exports = {
  listBillingPlans,
  getBillingOverview,
  initiateRenewalPayment,
  devMarkRenewalPaymentSuccessful,
  getRenewalPaymentStatus,
  getBillingUsage,

  // aliases to reduce mismatch with existing route names
  listPlans: listBillingPlans,
  getOverview: getBillingOverview,
  getCurrentSubscription: getBillingOverview,
  initiateRenewal: initiateRenewalPayment,
  markRenewalSuccessful: devMarkRenewalPaymentSuccessful,
  getPaymentStatus: getRenewalPaymentStatus,
};