const crypto = require("crypto");
const axios = require("axios");
const prisma = require("../../config/database");

const {
  getPlanByKey,
  getPlanSnapshot,
  isTrialPlanKey,
  isEnterprisePlanKey,
} = require("../../config/plans");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhoneTo250(phone) {
  const raw = String(phone || "").trim().replace(/[^\d]/g, "");
  if (!raw) return null;

  if (raw.startsWith("07") && raw.length === 10) {
    return `250${raw.slice(1)}`;
  }

  if (raw.startsWith("2507") && raw.length === 12) {
    return raw;
  }

  return raw;
}

function isRwandaMsisdn250(phone) {
  return /^2507\d{8}$/.test(String(phone || ""));
}

function getNow() {
  return new Date();
}

function addSeconds(base, seconds) {
  return new Date(new Date(base).getTime() + Number(seconds || 0) * 1000);
}

function randomId(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

function generateReference(prefix = "MOMO") {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}_${ts}_${rand}`;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return fallback;
}

function isMockModeEnabled() {
  return toBool(
    process.env.MOMO_MOCK_MODE ??
      process.env.MTN_MOMO_MOCK_MODE ??
      process.env.MOMO_TEST_MODE,
    false
  );
}

function getMoMoConfig() {
  const baseUrl =
    cleanString(process.env.MTN_MOMO_BASE_URL) ||
    cleanString(process.env.MOMO_BASE_URL) ||
    "https://sandbox.momodeveloper.mtn.com";

  const collectionApiUser =
    cleanString(process.env.MTN_MOMO_COLLECTION_API_USER) ||
    cleanString(process.env.MOMO_COLLECTION_API_USER) ||
    cleanString(process.env.MOMO_API_USER);

  const collectionApiKey =
    cleanString(process.env.MTN_MOMO_COLLECTION_API_KEY) ||
    cleanString(process.env.MOMO_COLLECTION_API_KEY) ||
    cleanString(process.env.MOMO_API_KEY);

  const collectionPrimaryKey =
    cleanString(process.env.MTN_MOMO_COLLECTION_PRIMARY_KEY) ||
    cleanString(process.env.MOMO_COLLECTION_PRIMARY_KEY) ||
    cleanString(process.env.MOMO_PRIMARY_KEY);

  const targetEnvironment =
    cleanString(process.env.MTN_MOMO_TARGET_ENVIRONMENT) ||
    cleanString(process.env.MOMO_TARGET_ENVIRONMENT) ||
    "sandbox";

  const callbackUrl =
    cleanString(process.env.MTN_MOMO_CALLBACK_URL) ||
    cleanString(process.env.MOMO_CALLBACK_URL) ||
    null;

  return {
    baseUrl,
    collectionApiUser,
    collectionApiKey,
    collectionPrimaryKey,
    targetEnvironment,
    callbackUrl,
    mockMode: isMockModeEnabled(),
  };
}

function assertPaidPlanOrThrow(planKey) {
  const plan = getPlanByKey(planKey);

  if (!plan) {
    const err = new Error("Invalid planKey");
    err.status = 400;
    throw err;
  }

  if (isTrialPlanKey(plan.key)) {
    const err = new Error("Trial plan does not require MoMo payment");
    err.status = 400;
    throw err;
  }

  if (isEnterprisePlanKey(plan.key)) {
    const err = new Error("Enterprise plan requires manual sales handling");
    err.status = 400;
    throw err;
  }

  return plan;
}

async function getOwnerIntentOrThrow(intentId) {
  const intent = await prisma.ownerIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      email: true,
      phone: true,
      ownerName: true,
      storeName: true,
      status: true,
      expiresAt: true,
      createdAt: true,
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

  if (intent.expiresAt && new Date(intent.expiresAt) < new Date()) {
    const err = new Error("Owner intent expired");
    err.status = 403;
    throw err;
  }

  if (String(intent.status || "").toUpperCase() === "CONSUMED") {
    const err = new Error("This signup is already completed. Please login.");
    err.status = 403;
    throw err;
  }

  return intent;
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
      graceEndDate: true,
      nextPlanKey: true,
      lastPaymentAt: true,
      renewedAt: true,
    },
  });

  if (!subscription) {
    const err = new Error("Subscription not found");
    err.status = 404;
    throw err;
  }

  return subscription;
}

async function ensureCollectionToken() {
  const cfg = getMoMoConfig();

  if (cfg.mockMode) {
    return {
      accessToken: `mock_token_${randomId(8)}`,
      expiresAt: addSeconds(getNow(), 3600),
      mock: true,
    };
  }

  if (!cfg.collectionApiUser || !cfg.collectionApiKey || !cfg.collectionPrimaryKey) {
    const err = new Error(
      "Missing MTN MoMo config. Required: collection api user, api key, and primary key."
    );
    err.status = 500;
    throw err;
  }

  const auth = Buffer.from(
    `${cfg.collectionApiUser}:${cfg.collectionApiKey}`
  ).toString("base64");

  try {
    const resp = await axios.post(
      `${cfg.baseUrl}/collection/token/`,
      {},
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Ocp-Apim-Subscription-Key": cfg.collectionPrimaryKey,
        },
      }
    );

    const accessToken = cleanString(resp?.data?.access_token);
    const expiresIn = Number(resp?.data?.expires_in || 0);

    if (!accessToken) {
      const err = new Error("Failed to obtain MTN MoMo access token");
      err.status = 502;
      throw err;
    }

    return {
      accessToken,
      expiresAt: addSeconds(getNow(), expiresIn > 0 ? expiresIn : 3600),
    };
  } catch (err) {
    const wrapped = new Error(
      err?.response?.data?.message ||
        err?.response?.data?.error_description ||
        err?.message ||
        "Failed to obtain MTN MoMo access token"
    );
    wrapped.status = err?.response?.status || err?.status || 502;
    wrapped.response = err?.response;
    throw wrapped;
  }
}

async function requestCollectionToPay({
  amount,
  currency,
  externalId,
  payerMsisdn,
  payerMessage,
  payeeNote,
}) {
  const cfg = getMoMoConfig();

  if (cfg.mockMode) {
    return {
      ok: true,
      providerStatusCode: 202,
      providerData: {
        message: "Mock MoMo request accepted",
        referenceId: externalId,
        targetEnvironment: "mock",
      },
      referenceId: externalId,
      targetEnvironment: "mock",
      mock: true,
    };
  }

  const { accessToken } = await ensureCollectionToken();

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "X-Reference-Id": externalId,
    "X-Target-Environment": cfg.targetEnvironment,
    "Ocp-Apim-Subscription-Key": cfg.collectionPrimaryKey,
    "Content-Type": "application/json",
  };

  if (cfg.callbackUrl) {
    headers["X-Callback-Url"] = cfg.callbackUrl;
  }

  const payload = {
    amount: String(Number(amount)),
    currency: String(currency || "RWF"),
    externalId: String(externalId),
    payer: {
      partyIdType: "MSISDN",
      partyId: String(payerMsisdn),
    },
    payerMessage: String(payerMessage || "Storvex payment"),
    payeeNote: String(payeeNote || "Storvex"),
  };

  try {
    const resp = await axios.post(
      `${cfg.baseUrl}/collection/v1_0/requesttopay`,
      payload,
      { headers }
    );

    return {
      ok: true,
      providerStatusCode: resp.status,
      providerData: resp.data || null,
      referenceId: externalId,
      targetEnvironment: cfg.targetEnvironment,
    };
  } catch (err) {
    const wrapped = new Error(
      err?.response?.data?.message ||
        err?.response?.data?.error_description ||
        err?.response?.data?.reason ||
        err?.message ||
        "MoMo request-to-pay failed"
    );
    wrapped.status = err?.response?.status || err?.status || 502;
    wrapped.response = err?.response;
    throw wrapped;
  }
}

async function createOrUpdateOwnerSignupPayment({
  intent,
  plan,
  phone,
  provider = "MOMO",
}) {
  const snap = getPlanSnapshot(plan.key);
  const reference = generateReference("SIGNUP");

  return prisma.$transaction(async (tx) => {
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

    const payment = await tx.payment.create({
      data: {
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
        provider: true,
        status: true,
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

    return { payment, snap };
  });
}

async function createOrUpdateRenewalPayment({
  tenantId,
  plan,
  provider = "MOMO",
}) {
  const snap = getPlanSnapshot(plan.key);
  const reference = generateReference("RENEW");

  const payment = await prisma.payment.create({
    data: {
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
      provider: true,
      status: true,
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

  await prisma.subscription.update({
    where: { tenantId },
    data: {
      nextPlanKey: snap.planKey,
    },
  });

  return { payment, snap };
}

async function createPaymentFromPlan(intentId, planKey, phone) {
  const intent = await getOwnerIntentOrThrow(cleanString(intentId));
  const normalizedPhone = normalizePhoneTo250(phone);

  if (!normalizedPhone || !isRwandaMsisdn250(normalizedPhone)) {
    const err = new Error("Invalid MSISDN format. Use 07XXXXXXXX or 2507XXXXXXXX");
    err.status = 400;
    throw err;
  }

  const plan = assertPaidPlanOrThrow(cleanString(planKey));

  const { payment, snap } = await createOrUpdateOwnerSignupPayment({
    intent,
    plan,
    phone: normalizedPhone,
    provider: "MOMO",
  });

  try {
    const providerResult = await requestCollectionToPay({
      amount: snap.price,
      currency: snap.currency,
      externalId: payment.reference,
      payerMsisdn: normalizedPhone,
      payerMessage: `Storvex ${snap.label || "signup"} payment`,
      payeeNote: `Storvex signup ${snap.planKey}`,
    });

    let finalPayment = payment;

    if (providerResult?.mock) {
  const [updatedPayment] = await prisma.$transaction([
    prisma.payment.update({
      where: { reference: payment.reference },
      data: {
        status: "SUCCESS",
      },
      select: {
        id: true,
        intentId: true,
        amount: true,
        currency: true,
        reference: true,
        provider: true,
        status: true,
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
    prisma.ownerIntent.update({
      where: { id: intent.id },
      data: {
        status: "PAID",
      },
    }),
  ]);

  finalPayment = updatedPayment;
}

    return {
      ok: true,
      paymentReference: payment.reference,
      intentId: intent.id,
      phone: normalizedPhone,
      plan: snap,
      payment: finalPayment,
      provider: providerResult,
    };
  } catch (err) {
    await prisma.payment.update({
      where: { reference: payment.reference },
      data: {
        status: "FAILED",
      },
    });

    throw err;
  }
}

async function createRenewalPaymentFromPlan(tenantId, planKey, phone) {
  const cleanTenantId = cleanString(tenantId);
  const normalizedPhone = normalizePhoneTo250(phone);

  if (!cleanTenantId) {
    const err = new Error("tenantId is required");
    err.status = 400;
    throw err;
  }

  if (!normalizedPhone || !isRwandaMsisdn250(normalizedPhone)) {
    const err = new Error("Invalid MSISDN format. Use 07XXXXXXXX or 2507XXXXXXXX");
    err.status = 400;
    throw err;
  }

  await getSubscriptionOrThrow(cleanTenantId);
  const plan = assertPaidPlanOrThrow(cleanString(planKey));

  const { payment, snap } = await createOrUpdateRenewalPayment({
    tenantId: cleanTenantId,
    plan,
    provider: "MOMO",
  });

  try {
    const providerResult = await requestCollectionToPay({
      amount: snap.price,
      currency: snap.currency,
      externalId: payment.reference,
      payerMsisdn: normalizedPhone,
      payerMessage: `Storvex ${snap.label || "renewal"} payment`,
      payeeNote: `Storvex renewal ${snap.planKey}`,
    });

    let finalPayment = payment;

    if (providerResult?.mock) {
      finalPayment = await prisma.payment.update({
        where: { reference: payment.reference },
        data: {
          status: "SUCCESS",
        },
        select: {
          id: true,
          tenantId: true,
          amount: true,
          currency: true,
          reference: true,
          provider: true,
          status: true,
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
    }

    return {
      ok: true,
      paymentReference: payment.reference,
      tenantId: cleanTenantId,
      phone: normalizedPhone,
      plan: snap,
      payment: finalPayment,
      provider: providerResult,
    };
  } catch (err) {
    await prisma.payment.update({
      where: { reference: payment.reference },
      data: {
        status: "FAILED",
      },
    });

    throw err;
  }
}

async function getPaymentStatus(reference) {
  const payment = await prisma.payment.findUnique({
    where: { reference: cleanString(reference) },
    select: {
      id: true,
      intentId: true,
      tenantId: true,
      amount: true,
      currency: true,
      reference: true,
      provider: true,
      status: true,
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
    const err = new Error("Payment not found");
    err.status = 404;
    throw err;
  }

  return payment;
}

module.exports = {
  normalizePhoneTo250,
  isRwandaMsisdn250,
  getMoMoConfig,
  ensureCollectionToken,
  requestCollectionToPay,
  createPaymentFromPlan,
  createRenewalPaymentFromPlan,
  getPaymentStatus,

  // compatibility aliases
  createOwnerPaymentFromPlan: createPaymentFromPlan,
  createRenewalPayment: createRenewalPaymentFromPlan,
};