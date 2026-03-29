// src/modules/billing/subscriptionAccess.js

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetweenCeil(futureDate, now = new Date()) {
  const ms = new Date(futureDate).getTime() - new Date(now).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function resolveSubscriptionAccess({
  tenantStatus,
  subscription,
  graceDays = 0, // kept for compatibility, but explicit graceEndDate is preferred
  now = new Date(),
}) {
  if (!subscription) {
    return {
      mode: "NO_SUBSCRIPTION",
      canRead: false,
      canOperate: false,
      reason: "No subscription found",
      endDate: null,
      trialEndDate: null,
      graceEndDate: null,
      readOnlySince: null,
      daysLeft: null,
    };
  }

  if (
    String(tenantStatus || "").toUpperCase() === "SUSPENDED" ||
    String(subscription.status || "").toUpperCase() === "SUSPENDED" ||
    String(subscription.accessMode || "").toUpperCase() === "SUSPENDED"
  ) {
    return {
      mode: "SUSPENDED",
      canRead: false,
      canOperate: false,
      reason: "Tenant is suspended",
      endDate: subscription.endDate || null,
      trialEndDate: subscription.trialEndDate || null,
      graceEndDate: subscription.graceEndDate || null,
      readOnlySince: subscription.readOnlySince || null,
      daysLeft: null,
    };
  }

  const endDate = toValidDate(subscription.endDate);
  const trialEndDate = toValidDate(subscription.trialEndDate);
  const graceEndDate = toValidDate(subscription.graceEndDate);

  if (!endDate) {
    return {
      mode: "DATA_ERROR",
      canRead: false,
      canOperate: false,
      reason: "Subscription endDate is invalid",
      endDate: subscription.endDate || null,
      trialEndDate: subscription.trialEndDate || null,
      graceEndDate: subscription.graceEndDate || null,
      readOnlySince: subscription.readOnlySince || null,
      daysLeft: null,
    };
  }

  // 1. Trial active
  if (trialEndDate && trialEndDate >= now) {
    return {
      mode: "TRIAL",
      canRead: true,
      canOperate: true,
      reason: "Trial active",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: null,
      daysLeft: daysBetweenCeil(trialEndDate, now),
    };
  }

  // 2. Paid / active subscription
  if (endDate >= now) {
    return {
      mode: "ACTIVE",
      canRead: true,
      canOperate: true,
      reason: "Subscription active",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: null,
      daysLeft: daysBetweenCeil(endDate, now),
    };
  }

  // 3. Grace / restricted period
  if (graceEndDate && graceEndDate >= now) {
    return {
      mode: "READ_ONLY",
      canRead: true,
      canOperate: false,
      reason: "Subscription expired but within grace period",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: subscription.readOnlySince || now,
      daysLeft: daysBetweenCeil(graceEndDate, now),
    };
  }

  // 4. Fully expired
  return {
    mode: "READ_ONLY",
    canRead: true,
    canOperate: false,
    reason: "Subscription expired; read-only mode enforced",
    endDate,
    trialEndDate,
    graceEndDate,
    readOnlySince: subscription.readOnlySince || now,
    daysLeft: 0,
  };
}

module.exports = {
  resolveSubscriptionAccess,
};