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

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
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

  const tenantStatusUpper = normalizeUpper(tenantStatus);
  const subscriptionStatusUpper = normalizeUpper(subscription.status);
  const accessModeUpper = normalizeUpper(subscription.accessMode);

  const endDate = toValidDate(subscription.endDate);
  const trialEndDate = toValidDate(subscription.trialEndDate);
  const graceEndDate = toValidDate(subscription.graceEndDate);
  const readOnlySince = toValidDate(subscription.readOnlySince);

  if (
    tenantStatusUpper === "SUSPENDED" ||
    subscriptionStatusUpper === "SUSPENDED" ||
    accessModeUpper === "SUSPENDED"
  ) {
    return {
      mode: "SUSPENDED",
      canRead: false,
      canOperate: false,
      reason: "Tenant is suspended",
      endDate: endDate || null,
      trialEndDate: trialEndDate || null,
      graceEndDate: graceEndDate || null,
      readOnlySince: readOnlySince || null,
      daysLeft: null,
    };
  }

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

  const trialStillValid = !!trialEndDate && trialEndDate >= now;
  const paidStillValid = endDate >= now;
  const graceStillValid = !!graceEndDate && graceEndDate >= now;

  // 1. Explicit trial state, only if trial is still valid
  if (accessModeUpper === "TRIAL" && trialStillValid) {
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

  // 2. Trial still valid even if accessMode is stale/missing
  if (trialStillValid) {
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

  // 3. Explicit read-only state takes precedence once trial is over
  if (accessModeUpper === "READ_ONLY") {
    return {
      mode: "READ_ONLY",
      canRead: true,
      canOperate: false,
      reason: "Read-only mode enforced",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: readOnlySince || now,
      daysLeft: graceStillValid ? daysBetweenCeil(graceEndDate, now) : 0,
    };
  }

  // 4. Paid / active subscription
  if (paidStillValid) {
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

  // 5. Grace / restricted period
  if (graceStillValid) {
    return {
      mode: "READ_ONLY",
      canRead: true,
      canOperate: false,
      reason: "Subscription expired but within grace period",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: readOnlySince || now,
      daysLeft: daysBetweenCeil(graceEndDate, now),
    };
  }

  // 6. Explicit expired state or fully expired fallback
  if (subscriptionStatusUpper === "EXPIRED") {
    return {
      mode: "READ_ONLY",
      canRead: true,
      canOperate: false,
      reason: "Subscription expired; read-only mode enforced",
      endDate,
      trialEndDate,
      graceEndDate,
      readOnlySince: readOnlySince || now,
      daysLeft: 0,
    };
  }

  return {
    mode: "READ_ONLY",
    canRead: true,
    canOperate: false,
    reason: "Subscription expired; read-only mode enforced",
    endDate,
    trialEndDate,
    graceEndDate,
    readOnlySince: readOnlySince || now,
    daysLeft: 0,
  };
}

module.exports = {
  resolveSubscriptionAccess,
};