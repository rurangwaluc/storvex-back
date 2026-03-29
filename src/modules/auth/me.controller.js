const prisma = require("../../config/database");
const { getGraceDays } = require("../../config/plans");
const { resolveSubscriptionAccess } = require("../billing/subscriptionAccess");
const { buildTrialBanner, getSetupChecklist } = require("../store/store.service");

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize backend subscription state into a stable frontend contract.
 *
 * Desired frontend modes:
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

  const isTrial =
    !!trialEndDate &&
    trialEndDate >= now &&
    storedAccessMode === "TRIAL";

  if (isTrial) {
    return "TRIAL";
  }

  const isGrace =
    !!endDate &&
    endDate < now &&
    !!graceEndDate &&
    graceEndDate >= now;

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

async function me(req, res) {
  try {
    const userId = req.user?.userId;
    const tenantId = req.user?.tenantId;

    if (!userId || !tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [user, tenant, subscription] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, tenantId: true },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          status: true,
          shopType: true,
          district: true,
          sector: true,
          address: true,
          logoUrl: true,
          receiptHeader: true,
          receiptFooter: true,
          onboardingCompleted: true,
          onboardingCompletedAt: true,
          cash_drawer_block_cash_sales: true,
          phone: true,
        },
      }),
      prisma.subscription.findUnique({
        where: { tenantId },
        select: {
          id: true,
          status: true,
          accessMode: true,
          planKey: true,
          startDate: true,
          endDate: true,
          trialStartDate: true,
          trialEndDate: true,
          graceEndDate: true,
          readOnlySince: true,
          lastPaymentAt: true,
          renewedAt: true,
        },
      }),
    ]);

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

    return res.json({
      user,
      tenant: tenant
        ? {
            ...tenant,
            cashDrawerBlockCashSales: tenant.cash_drawer_block_cash_sales,
          }
        : null,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            storedAccessMode: subscription.accessMode,
            accessMode: frontendAccessMode,
            planKey: subscription.planKey,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            trialStartDate: subscription.trialStartDate,
            trialEndDate: subscription.trialEndDate,
            graceEndDate: resolved.graceEndDate || subscription.graceEndDate,
            readOnlySince: subscription.readOnlySince,
            lastPaymentAt: subscription.lastPaymentAt,
            renewedAt: subscription.renewedAt,
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
    return res.status(500).json({ message: "Server error" });
  }
}

module.exports = { me };