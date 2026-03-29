// src/modules/auth/payment.controller.js
const crypto = require("crypto");
const prisma = require("../../config/database");

const {
  getPaidPlans,
  getPlanByKey,
  getPlanSnapshot,
  isTrialPlanKey,
} = require("../../config/plans");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeIntentId(value) {
  const s = cleanString(value);
  return s || null;
}

function makeReference(prefix = "PAY") {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}_${ts}_${rand}`;
}

function snapshotFromPlan(plan) {
  if (!plan) return null;

  const snap = getPlanSnapshot(plan.key);
  if (snap) return snap;

  return {
    planKey: plan.key || null,
    tierKey: plan.tierKey || null,
    cycleKey: plan.cycleKey || null,
    label: plan.label || null,
    tierLabel: plan.tierLabel || null,
    cycleLabel: plan.cycleLabel || null,
    days: Number.isFinite(Number(plan.days)) ? Number(plan.days) : null,
    price: Number.isFinite(Number(plan.price)) ? Number(plan.price) : null,
    currency: plan.currency || "RWF",
    staffLimit: Number.isFinite(Number(plan.staffLimit)) ? Number(plan.staffLimit) : null,
    isEnterprise: Boolean(plan.isEnterprise),
  };
}

function resolveProvider(value) {
  const v = String(value || "MOMO").trim().toUpperCase();
  if (v === "MOMO" || v === "BANK" || v === "CARD" || v === "CASH" || v === "OTHER") {
    return v;
  }
  return "MOMO";
}

function assertPaidPlanOrThrow(planKey) {
  const plan = getPlanByKey(planKey);

  if (!plan) {
    const err = new Error("Invalid paid plan");
    err.status = 400;
    throw err;
  }

  if (isTrialPlanKey(plan.key)) {
    const err = new Error("Trial does not require payment");
    err.status = 400;
    throw err;
  }

  return plan;
}

function getPaymentPurposeKind(purpose) {
  const p = String(purpose || "").trim().toUpperCase();

  if (p === "SIGNUP" || p === "OWNER_SIGNUP") return "SIGNUP";
  if (p === "RENEWAL" || p === "SUBSCRIPTION_RENEWAL") return "RENEWAL";
  return "UNKNOWN";
}

async function getOwnerIntentOrThrow(intentId) {
  const intent = await prisma.ownerIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      email: true,
      phone: true,
      storeName: true,
      ownerName: true,
      status: true,
      expiresAt: true,
      createdAt: true,
      deviceId: true,
      browserFingerprint: true,
      requestedPlanKey: true,
      requestedTierKey: true,
      requestedCycleKey: true,
      requestedStaffLimit: true,
      requestedPriceAmount: true,
      requestedCurrency: true,
    },
  });

  if (!intent) {
    const err = new Error("Owner intent not found");
    err.status = 404;
    throw err;
  }

  if (intent.expiresAt < new Date()) {
    const err = new Error("Owner intent expired");
    err.status = 403;
    throw err;
  }

  if (intent.status === "CONSUMED") {
    const err = new Error("This signup was already completed. Please login.");
    err.status = 403;
    throw err;
  }

  return intent;
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function resolveRenewalStartDate(subscription) {
  const now = new Date();
  const endDate = subscription?.endDate ? new Date(subscription.endDate) : null;

  if (endDate && !Number.isNaN(endDate.getTime()) && endDate > now) {
    return endDate;
  }

  return now;
}

function getGraceDaysSafe() {
  const n = Number(process.env.GRACE_DAYS || 3);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

async function markSignupPaymentSuccessful({ payment, provider }) {
  const purposeKind = getPaymentPurposeKind(payment.purpose);
  if (purposeKind !== "SIGNUP") {
    const err = new Error("This payment is not a signup payment");
    err.status = 400;
    throw err;
  }

  const intentId = payment.intentId;
  if (!intentId) {
    const err = new Error("Payment is missing intentId");
    err.status = 400;
    throw err;
  }

  const intent = await prisma.ownerIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      status: true,
      expiresAt: true,
      requestedPlanKey: true,
      requestedTierKey: true,
      requestedCycleKey: true,
      requestedStaffLimit: true,
      requestedPriceAmount: true,
      requestedCurrency: true,
    },
  });

  if (!intent) {
    const err = new Error("Owner intent not found");
    err.status = 404;
    throw err;
  }

  if (intent.expiresAt < new Date()) {
    const err = new Error("Owner intent expired");
    err.status = 403;
    throw err;
  }

  const effectivePlanKey = cleanString(payment.planKey) || cleanString(intent.requestedPlanKey);
  if (!effectivePlanKey) {
    const err = new Error("Missing paid plan on payment/intent");
    err.status = 400;
    throw err;
  }

  const plan = assertPaidPlanOrThrow(effectivePlanKey);
  const snap = snapshotFromPlan(plan);

  return prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { reference: payment.reference },
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
        intentId: true,
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

    const updatedIntent = await tx.ownerIntent.update({
      where: { id: intent.id },
      data: {
        status: "PAID",
        requestedPlanKey: snap.planKey,
        requestedTierKey: snap.tierKey,
        requestedCycleKey: snap.cycleKey,
        requestedStaffLimit: snap.staffLimit,
        requestedPriceAmount: snap.price,
        requestedCurrency: snap.currency,
      },
      select: {
        id: true,
        status: true,
        requestedPlanKey: true,
        requestedTierKey: true,
        requestedCycleKey: true,
        requestedStaffLimit: true,
        requestedPriceAmount: true,
        requestedCurrency: true,
      },
    });

    return {
      kind: "SIGNUP",
      payment: updatedPayment,
      intent: updatedIntent,
      plan: snap,
    };
  });
}

async function markRenewalPaymentSuccessful({ payment, provider }) {
  const purposeKind = getPaymentPurposeKind(payment.purpose);
  if (purposeKind !== "RENEWAL") {
    const err = new Error("This payment is not a renewal payment");
    err.status = 400;
    throw err;
  }

  if (!payment.tenantId) {
    const err = new Error("Renewal payment is missing tenantId");
    err.status = 400;
    throw err;
  }

  const subscription = await prisma.subscription.findUnique({
    where: { tenantId: payment.tenantId },
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

  const effectivePlanKey = cleanString(payment.planKey) || cleanString(subscription.nextPlanKey);
  if (!effectivePlanKey) {
    const err = new Error("Renewal payment is missing planKey");
    err.status = 400;
    throw err;
  }

  const plan = assertPaidPlanOrThrow(effectivePlanKey);
  const snap = snapshotFromPlan(plan);

  const renewalStart = resolveRenewalStartDate(subscription);
  const newEndDate = addDays(renewalStart, snap.days);
  const graceEndDate = addDays(newEndDate, getGraceDaysSafe());
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { reference: payment.reference },
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
        intentId: true,
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
        graceEndDate: true,
        readOnlySince: true,
        lastPaymentAt: true,
        renewedAt: true,
        createdAt: true,
      },
    });

    return {
      kind: "RENEWAL",
      payment: updatedPayment,
      subscription: updatedSubscription,
      plan: snap,
    };
  });
}

async function markPaymentSuccessfulByReference({ reference, provider }) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: {
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
      priceAmount: true,
    },
  });

  if (!payment) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }

  if (payment.status === "SUCCESS") {
    const kind = getPaymentPurposeKind(payment.purpose);
    return {
      alreadySuccessful: true,
      kind,
      payment,
    };
  }

  const kind = getPaymentPurposeKind(payment.purpose);

  if (kind === "SIGNUP") {
    return markSignupPaymentSuccessful({ payment, provider });
  }

  if (kind === "RENEWAL") {
    return markRenewalPaymentSuccessful({ payment, provider });
  }

  const err = new Error("Unsupported payment purpose");
  err.status = 400;
  throw err;
}

async function markPaymentFailedByReference({ reference, provider, failureReason }) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      status: true,
      provider: true,
      purpose: true,
    },
  });

  if (!payment) {
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }

  if (payment.status === "SUCCESS") {
    const err = new Error("Cannot mark a successful payment as failed");
    err.status = 400;
    throw err;
  }

  const updated = await prisma.payment.update({
    where: { reference },
    data: {
      provider: provider || payment.provider,
      status: "FAILED",
    },
    select: {
      id: true,
      reference: true,
      status: true,
      provider: true,
      purpose: true,
      updatedAt: true,
    },
  });

  return {
    payment: updated,
    failureReason: cleanString(failureReason) || null,
  };
}

async function listSignupPlans(req, res) {
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
    console.error("listSignupPlans error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

async function initiateOwnerPayment(req, res) {
  try {
    const intentId = normalizeIntentId(req.body.intentId);
    const requestedPlanKey = cleanString(req.body.planKey);
    const provider = resolveProvider(req.body.provider);
    const externalReference = cleanString(req.body.reference);

    if (!intentId) {
      return res.status(400).json({ message: "intentId is required" });
    }

    const intent = await getOwnerIntentOrThrow(intentId);

    const effectivePlanKey = requestedPlanKey || cleanString(intent.requestedPlanKey);
    if (!effectivePlanKey) {
      return res.status(400).json({ message: "planKey is required for paid signup" });
    }

    const plan = assertPaidPlanOrThrow(effectivePlanKey);
    const snap = snapshotFromPlan(plan);
    const reference = externalReference || makeReference("SIGNUP");

    const payment = await prisma.$transaction(async (tx) => {
      await tx.ownerIntent.update({
        where: { id: intent.id },
        data: {
          requestedPlanKey: snap.planKey,
          requestedTierKey: snap.tierKey,
          requestedCycleKey: snap.cycleKey,
          requestedStaffLimit: snap.staffLimit,
          requestedPriceAmount: snap.price,
          requestedCurrency: snap.currency,
        },
      });

      return tx.payment.upsert({
        where: { reference },
        update: {
          intentId: intent.id,
          amount: snap.price,
          currency: snap.currency,
          provider,
          status: "PENDING",
          purpose: "OWNER_SIGNUP",
          planKey: snap.planKey,
          tierKey: snap.tierKey,
          cycleKey: snap.cycleKey,
          staffLimit: snap.staffLimit,
          priceAmount: snap.price,
        },
        create: {
          intentId: intent.id,
          amount: snap.price,
          currency: snap.currency,
          reference,
          provider,
          status: "PENDING",
          purpose: "OWNER_SIGNUP",
          planKey: snap.planKey,
          tierKey: snap.tierKey,
          cycleKey: snap.cycleKey,
          staffLimit: snap.staffLimit,
          priceAmount: snap.price,
        },
        select: {
          id: true,
          intentId: true,
          amount: true,
          currency: true,
          reference: true,
          status: true,
          provider: true,
          createdAt: true,
          updatedAt: true,
          purpose: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
          priceAmount: true,
        },
      });
    });

    return res.status(201).json({
      message: "Signup payment initiated",
      payment,
      plan: snap,
      intent: {
        id: intent.id,
        email: intent.email,
        phone: intent.phone,
        storeName: intent.storeName,
        ownerName: intent.ownerName,
        status: intent.status,
      },
    });
  } catch (err) {
    console.error("initiateOwnerPayment error:", err);
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Payment initiation failed" });
  }
}

async function devMarkOwnerPaymentSuccessful(req, res) {
  try {
    const reference = cleanString(req.body.reference);
    const provider = resolveProvider(req.body.provider || "MOMO");

    if (!reference) {
      return res.status(400).json({ message: "reference is required" });
    }

    const result = await markPaymentSuccessfulByReference({ reference, provider });

    return res.json({
      message: "Owner signup payment marked successful",
      ...result,
    });
  } catch (err) {
    console.error("devMarkOwnerPaymentSuccessful error:", err);
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Failed to mark payment successful" });
  }
}

async function getOwnerPaymentStatus(req, res) {
  try {
    const reference = cleanString(req.params.reference || req.query.reference || req.body.reference);

    if (!reference) {
      return res.status(400).json({ message: "reference is required" });
    }

    const payment = await prisma.payment.findUnique({
      where: { reference },
      select: {
        id: true,
        intentId: true,
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

    return res.json({ payment });
  } catch (err) {
    console.error("getOwnerPaymentStatus error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

/**
 * Real MoMo callback.
 * We acknowledge safely, then try to update payment status if enough info is present.
 * This is intentionally tolerant because sandbox/provider payloads vary.
 */
async function momoCallback(req, res) {
  try {
    const body = req.body || {};

    const reference =
      cleanString(body.reference) ||
      cleanString(body.externalId) ||
      cleanString(body.financialTransactionId) ||
      cleanString(body?.data?.reference) ||
      cleanString(body?.data?.externalId) ||
      cleanString(body?.data?.financialTransactionId);

    const statusRaw =
      cleanString(body.status) ||
      cleanString(body.reason) ||
      cleanString(body?.data?.status) ||
      cleanString(body?.data?.reason);

    const normalizedStatus = String(statusRaw || "").toUpperCase();

    // Always acknowledge webhook quickly.
    res.status(200).json({ ok: true });

    if (!reference) {
      console.log("momoCallback: acknowledged, but no reference found in payload");
      return;
    }

    const isSuccess =
      normalizedStatus.includes("SUCCESS") ||
      normalizedStatus.includes("SUCCESSFUL") ||
      normalizedStatus.includes("COMPLETED");

    const isFailure =
      normalizedStatus.includes("FAILED") ||
      normalizedStatus.includes("FAIL") ||
      normalizedStatus.includes("REJECTED") ||
      normalizedStatus.includes("CANCELLED");

    if (isSuccess) {
      try {
        await markPaymentSuccessfulByReference({
          reference,
          provider: "MTN_MOMO",
        });
        console.log("momoCallback: payment marked SUCCESS for reference:", reference);
      } catch (err) {
        console.error("momoCallback success processing error:", err.message);
      }
      return;
    }

    if (isFailure) {
      try {
        await markPaymentFailedByReference({
          reference,
          provider: "MTN_MOMO",
          failureReason: statusRaw,
        });
        console.log("momoCallback: payment marked FAILED for reference:", reference);
      } catch (err) {
        console.error("momoCallback failure processing error:", err.message);
      }
      return;
    }

    console.log("momoCallback: acknowledged with unrecognized status for reference:", reference);
  } catch (err) {
    console.error("momoCallback error:", err);
    if (!res.headersSent) {
      return res.status(200).json({ ok: true });
    }
  }
}

/**
 * Dev callback:
 * lets you simulate success/failure from Postman or local UI.
 *
 * Body examples:
 * { "reference": "....", "status": "SUCCESS" }
 * { "reference": "....", "status": "FAILED" }
 */
async function momoCallbackDev(req, res) {
  try {
    const reference = cleanString(req.body.reference);
    const provider = resolveProvider(req.body.provider || "MOMO");
    const status = String(req.body.status || "SUCCESS").trim().toUpperCase();

    if (!reference) {
      return res.status(400).json({ message: "reference is required" });
    }

    if (status === "SUCCESS") {
      const result = await markPaymentSuccessfulByReference({ reference, provider });

      return res.json({
        message: "Dev callback applied: payment marked successful",
        ...result,
      });
    }

    if (status === "FAILED") {
      const result = await markPaymentFailedByReference({
        reference,
        provider,
        failureReason: cleanString(req.body.failureReason) || "DEV_FAILED",
      });

      return res.json({
        message: "Dev callback applied: payment marked failed",
        ...result,
      });
    }

    return res.status(400).json({
      message: "Invalid status. Use SUCCESS or FAILED",
    });
  } catch (err) {
    console.error("momoCallbackDev error:", err);
    return res
      .status(err.status || 500)
      .json({ message: err.message || "Dev callback failed" });
  }
}

module.exports = {
  listSignupPlans,
  initiateOwnerPayment,
  devMarkOwnerPaymentSuccessful,
  getOwnerPaymentStatus,
  momoCallback,
  momoCallbackDev,
};