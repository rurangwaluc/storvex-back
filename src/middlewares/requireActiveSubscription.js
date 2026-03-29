const prisma = require("../config/database");

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function serializeSubscription(subscription, activeUsers = null) {
  if (!subscription) return null;

  const staffLimit = Number.isFinite(Number(subscription.staffLimit))
    ? Number(subscription.staffLimit)
    : null;

  const activeStaff =
    Number.isFinite(Number(activeUsers)) && Number(activeUsers) >= 0
      ? Number(activeUsers)
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
    startDate: subscription.startDate || null,
    endDate: subscription.endDate || null,
    trialStartDate: subscription.trialStartDate || null,
    trialEndDate: subscription.trialEndDate || null,
    graceEndDate: subscription.graceEndDate || null,
    readOnlySince: subscription.readOnlySince || null,
    lastPaymentAt: subscription.lastPaymentAt || null,
    renewedAt: subscription.renewedAt || null,
    trialConsumed: Boolean(subscription.trialConsumed),
    trialSourceIntentId: subscription.trialSourceIntentId || null,
    nextPlanKey: subscription.nextPlanKey || null,
    createdAt: subscription.createdAt || null,
    activeStaff,
    overLimit:
      staffLimit != null && activeStaff != null ? Number(activeStaff) > Number(staffLimit) : false,
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

function isTrialStillActive(subscription, now) {
  const trialEndDate = toValidDate(subscription.trialEndDate);
  if (!trialEndDate) return false;
  return trialEndDate >= now;
}

function isMainAccessStillActive(subscription, now) {
  const endDate = toValidDate(subscription.endDate);
  if (!endDate) return false;
  return endDate >= now;
}

function isGraceStillActive(subscription, now) {
  const graceEndDate = toValidDate(subscription.graceEndDate);
  if (!graceEndDate) return false;
  return graceEndDate >= now;
}

/**
 * Normalized lifecycle:
 *
 * 1. Trial active:
 *    status = ACTIVE
 *    accessMode = TRIAL
 *
 * 2. Paid active:
 *    status = ACTIVE
 *    accessMode = ACTIVE
 *
 * 3. Grace / restricted:
 *    status = ACTIVE
 *    accessMode = READ_ONLY
 *
 * 4. Fully expired:
 *    status = EXPIRED
 *    accessMode = READ_ONLY
 *
 * Why EXPIRED + READ_ONLY?
 * - Your SubscriptionStatus enum does not contain GRACE
 * - Your SubscriptionAccessMode enum does not contain BLOCKED
 * - Middleware will deny access when status === EXPIRED
 */
async function updateSubscriptionAccessModeIfNeeded(subscription) {
  const now = new Date();

  // Preserve manual suspension if it already exists
  if (
    String(subscription.status || "").toUpperCase() === "SUSPENDED" ||
    String(subscription.accessMode || "").toUpperCase() === "SUSPENDED"
  ) {
    if (subscription.status !== "SUSPENDED" || subscription.accessMode !== "SUSPENDED") {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          status: "SUSPENDED",
          accessMode: "SUSPENDED",
          readOnlySince: subscription.readOnlySince || now,
        },
      });
    }
    return subscription;
  }

  const trialActive = isTrialStillActive(subscription, now);
  const active = isMainAccessStillActive(subscription, now);
  const graceActive = isGraceStillActive(subscription, now);

  // Trial still active
  if (trialActive) {
    if (subscription.status !== "ACTIVE" || subscription.accessMode !== "TRIAL") {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          status: "ACTIVE",
          accessMode: "TRIAL",
          readOnlySince: null,
        },
      });
    }

    if (subscription.readOnlySince) {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          readOnlySince: null,
        },
      });
    }

    return subscription;
  }

  // Paid / normal active
  if (active) {
    if (subscription.status !== "ACTIVE" || subscription.accessMode !== "ACTIVE") {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          status: "ACTIVE",
          accessMode: "ACTIVE",
          readOnlySince: null,
        },
      });
    }

    if (subscription.readOnlySince) {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          readOnlySince: null,
        },
      });
    }

    return subscription;
  }

  // Grace period -> read only
  if (graceActive) {
    if (subscription.status !== "ACTIVE" || subscription.accessMode !== "READ_ONLY") {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          status: "ACTIVE",
          accessMode: "READ_ONLY",
          readOnlySince: subscription.readOnlySince || now,
        },
      });
    }

    if (!subscription.readOnlySince) {
      return prisma.subscription.update({
        where: { tenantId: subscription.tenantId },
        data: {
          readOnlySince: now,
        },
      });
    }

    return subscription;
  }

  // Fully expired -> deny at middleware level
  if (subscription.status !== "EXPIRED" || subscription.accessMode !== "READ_ONLY") {
    return prisma.subscription.update({
      where: { tenantId: subscription.tenantId },
      data: {
        status: "EXPIRED",
        accessMode: "READ_ONLY",
        readOnlySince: subscription.readOnlySince || now,
      },
    });
  }

  if (!subscription.readOnlySince) {
    return prisma.subscription.update({
      where: { tenantId: subscription.tenantId },
      data: {
        readOnlySince: now,
      },
    });
  }

  return subscription;
}

async function resolveSubscriptionAccess(tenantId) {
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
    return {
      ok: false,
      code: "NO_SUBSCRIPTION",
      subscription: null,
      activeUsers: 0,
    };
  }

  const updatedSubscription = await updateSubscriptionAccessModeIfNeeded(subscription);
  const activeUsers = await countActiveBillableUsers(tenantId);

  return {
    ok: true,
    code:
      String(updatedSubscription.status || "").toUpperCase() === "EXPIRED"
        ? "SUBSCRIPTION_BLOCKED"
        : updatedSubscription.accessMode || "ACTIVE",
    subscription: updatedSubscription,
    activeUsers,
  };
}

/**
 * Main gate:
 * - ACTIVE / TRIAL => allow full access
 * - READ_ONLY with status ACTIVE => allow request, but flag request as read-only
 * - EXPIRED => deny request
 * - SUSPENDED => deny request
 */
async function requireActiveSubscription(req, res, next) {
  try {
    const tenantId = req.user?.tenantId || req.tenantId || req.params?.tenantId || null;

    if (!tenantId) {
      return res.status(401).json({ message: "Missing tenant context" });
    }

    const result = await resolveSubscriptionAccess(tenantId);

    if (!result.ok) {
      return res.status(403).json({
        message: "No active subscription found",
        code: result.code,
      });
    }

    req.subscription = result.subscription;
    req.subscriptionAccess = result.subscription.accessMode;
    req.subscriptionUsage = {
      activeStaff: result.activeUsers,
      staffLimit:
        Number.isFinite(Number(result.subscription.staffLimit))
          ? Number(result.subscription.staffLimit)
          : null,
      overLimit:
        Number.isFinite(Number(result.subscription.staffLimit)) &&
        Number(result.activeUsers) > Number(result.subscription.staffLimit),
    };

    req.subscriptionMeta = serializeSubscription(result.subscription, result.activeUsers);

    if (String(result.subscription.status || "").toUpperCase() === "EXPIRED") {
      return res.status(403).json({
        message: "Subscription expired. Renewal required.",
        code: "SUBSCRIPTION_BLOCKED",
        subscription: req.subscriptionMeta,
      });
    }

    if (String(result.subscription.accessMode || "").toUpperCase() === "SUSPENDED") {
      return res.status(403).json({
        message: "Account suspended. Contact support.",
        code: "SUBSCRIPTION_SUSPENDED",
        subscription: req.subscriptionMeta,
      });
    }

    if (String(result.subscription.accessMode || "").toUpperCase() === "READ_ONLY") {
      req.isReadOnlyMode = true;
      return next();
    }

    req.isReadOnlyMode = false;
    return next();
  } catch (err) {
    console.error("requireActiveSubscription error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Optional helper middleware:
 * blocks write requests when tenant is in READ_ONLY mode.
 */
function blockWritesInReadOnlyMode(req, res, next) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];

    if (!writeMethods.includes(method)) {
      return next();
    }

    if (req.isReadOnlyMode) {
      return res.status(403).json({
        message: "Subscription is in read-only mode. Renew to continue writing data.",
        code: "SUBSCRIPTION_READ_ONLY",
        subscription: req.subscriptionMeta || null,
      });
    }

    return next();
  } catch (err) {
    console.error("blockWritesInReadOnlyMode error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Optional helper:
 * use on routes that need full writable access.
 */
function requireWritableSubscription(req, res, next) {
  try {
    if (String(req.subscription?.status || "").toUpperCase() === "EXPIRED") {
      return res.status(403).json({
        message: "Subscription expired. Renewal required.",
        code: "SUBSCRIPTION_BLOCKED",
        subscription: req.subscriptionMeta || null,
      });
    }

    if (String(req.subscriptionAccess || "").toUpperCase() === "SUSPENDED") {
      return res.status(403).json({
        message: "Account suspended. Contact support.",
        code: "SUBSCRIPTION_SUSPENDED",
        subscription: req.subscriptionMeta || null,
      });
    }

    if (req.isReadOnlyMode) {
      return res.status(403).json({
        message: "Subscription is in read-only mode. Renew to continue.",
        code: "SUBSCRIPTION_READ_ONLY",
        subscription: req.subscriptionMeta || null,
      });
    }

    return next();
  } catch (err) {
    console.error("requireWritableSubscription error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  requireActiveSubscription,
  blockWritesInReadOnlyMode,
  requireWritableSubscription,
  resolveSubscriptionAccess,
};