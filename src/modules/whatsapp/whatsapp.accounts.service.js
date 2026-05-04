const crypto = require("crypto");
const prisma = require("../../config/database");

function appError(code, extra = {}) {
  const err = new Error(code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function normalizeStr(value) {
  const s = String(value || "").trim();
  return s || null;
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizePhone(value) {
  const raw = digitsOnly(value);
  return raw || null;
}

function normalizeBoolean(value, fallback = null) {
  if (value === undefined || value === null) return fallback;

  if (typeof value === "boolean") return value;

  const text = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "on", "active"].includes(text)) return true;
  if (["false", "0", "no", "n", "off", "inactive"].includes(text)) return false;

  return fallback;
}

function maskSecret(value) {
  return value ? "********" : null;
}

function hasValue(value) {
  return normalizeStr(value) !== null;
}

function resolveFinalValue(nextValue, existingValue) {
  if (nextValue === undefined) return existingValue;
  return nextValue;
}

function generateVerifyToken() {
  return `storvex_${crypto.randomBytes(24).toString("hex")}`;
}

function buildSetupStatus(account) {
  const hasPhone = hasValue(account?.phoneNumber);
  const hasPhoneNumberId = hasValue(account?.phoneNumberId);
  const hasWabaId = hasValue(account?.wabaId);
  const hasAccessToken = hasValue(account?.accessToken);
  const hasWebhookVerifyToken = hasValue(account?.webhookVerifyToken);
  const hasAppSecret = hasValue(account?.appSecret);

  const requiredMissing = [];

  if (!hasPhone) requiredMissing.push("PHONE_NUMBER");
  if (!hasPhoneNumberId) requiredMissing.push("PHONE_NUMBER_ID");
  if (!hasAccessToken) requiredMissing.push("ACCESS_TOKEN");
  if (!hasWebhookVerifyToken) requiredMissing.push("WEBHOOK_VERIFY_TOKEN");

  const warnings = [];

  if (!hasWabaId) warnings.push("WABA_ID_MISSING");
  if (!hasAppSecret) warnings.push("APP_SECRET_MISSING");

  return {
    isReady: requiredMissing.length === 0 && Boolean(account?.isActive),
    isActive: Boolean(account?.isActive),
    requiredMissing,
    warnings,
    checks: {
      hasPhone,
      hasPhoneNumberId,
      hasWabaId,
      hasAccessToken,
      hasWebhookVerifyToken,
      hasAppSecret,
    },
  };
}

function buildPublicAccount(account) {
  if (!account) return null;

  const setupStatus = buildSetupStatus(account);

  return {
    id: account.id,
    tenantId: account.tenantId,

    phoneNumber: account.phoneNumber,
    businessName: account.businessName,

    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,

    webhookVerifyToken: maskSecret(account.webhookVerifyToken),
    appSecret: maskSecret(account.appSecret),
    hasAccessToken: Boolean(account.accessToken),

    isActive: Boolean(account.isActive),
    setupStatus,

    channelStrategy: {
      mode: "ONE_STORE_NUMBER",
      customerFacingLabel: "One WhatsApp number for the store",
      internalBranchRule:
        "Conversations are tenant-level. Sales, stock, cash drawer, receipts, and audit records must resolve to an internal branch before business actions.",
      branchIdRequiredOnAccount: false,
    },

    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function validateRequiredPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    throw appError("PHONE_NUMBER_REQUIRED");
  }

  if (String(phoneNumber).length < 8) {
    throw appError("PHONE_NUMBER_INVALID");
  }
}

function validateActiveCredentials({ phoneNumberId, accessToken, webhookVerifyToken, isActive }) {
  if (!isActive) return;

  if (!normalizeStr(phoneNumberId)) {
    throw appError("PHONE_NUMBER_ID_REQUIRED_WHEN_ACTIVE");
  }

  if (!normalizeStr(accessToken)) {
    throw appError("ACCESS_TOKEN_REQUIRED_WHEN_ACTIVE");
  }

  if (!normalizeStr(webhookVerifyToken)) {
    throw appError("WEBHOOK_VERIFY_TOKEN_REQUIRED_WHEN_ACTIVE");
  }
}

async function ensureTenantExists(tenantId) {
  if (!tenantId) {
    throw appError("TENANT_REQUIRED");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!tenant) {
    throw appError("TENANT_NOT_FOUND");
  }

  return tenant;
}

async function enforceSingleStoreNumber(tenantId, exceptId = null) {
  const existing = await prisma.whatsAppAccount.findFirst({
    where: {
      tenantId,
      ...(exceptId ? { id: { not: String(exceptId) } } : {}),
    },
    select: {
      id: true,
      phoneNumber: true,
      businessName: true,
      isActive: true,
    },
  });

  if (existing) {
    throw appError("ONE_WHATSAPP_ACCOUNT_ALLOWED", {
      existingAccountId: existing.id,
    });
  }
}

function normalizeCreatePayload(data = {}, tenant = null) {
  const phoneNumber = normalizePhone(data.phoneNumber);
  const businessName =
    normalizeStr(data.businessName) ||
    normalizeStr(tenant?.name) ||
    null;

  const phoneNumberId = normalizeStr(data.phoneNumberId);
  const wabaId = normalizeStr(data.wabaId);
  const accessToken = normalizeStr(data.accessToken);

  const webhookVerifyToken =
    normalizeStr(data.webhookVerifyToken) ||
    normalizeStr(data.verifyToken) ||
    generateVerifyToken();

  const appSecret = normalizeStr(data.appSecret);
  const isActive = normalizeBoolean(data.isActive, false);

  return {
    phoneNumber,
    businessName,
    phoneNumberId,
    wabaId,
    accessToken,
    webhookVerifyToken,
    appSecret,
    isActive,
  };
}

function normalizeUpdatePayload(data = {}, existing) {
  const nextPhoneNumber = resolveFinalValue(
    data.phoneNumber !== undefined ? normalizePhone(data.phoneNumber) : undefined,
    existing.phoneNumber
  );

  const nextBusinessName = resolveFinalValue(
    data.businessName !== undefined ? normalizeStr(data.businessName) : undefined,
    existing.businessName
  );

  const nextPhoneNumberId = resolveFinalValue(
    data.phoneNumberId !== undefined ? normalizeStr(data.phoneNumberId) : undefined,
    existing.phoneNumberId
  );

  const nextWabaId = resolveFinalValue(
    data.wabaId !== undefined ? normalizeStr(data.wabaId) : undefined,
    existing.wabaId
  );

  const nextAccessToken = resolveFinalValue(
    data.accessToken !== undefined ? normalizeStr(data.accessToken) : undefined,
    existing.accessToken
  );

  const nextWebhookVerifyToken = resolveFinalValue(
    data.webhookVerifyToken !== undefined
      ? normalizeStr(data.webhookVerifyToken)
      : data.verifyToken !== undefined
        ? normalizeStr(data.verifyToken)
        : undefined,
    existing.webhookVerifyToken
  );

  const nextAppSecret = resolveFinalValue(
    data.appSecret !== undefined ? normalizeStr(data.appSecret) : undefined,
    existing.appSecret
  );

  const nextIsActive = resolveFinalValue(
    data.isActive !== undefined ? normalizeBoolean(data.isActive, false) : undefined,
    Boolean(existing.isActive)
  );

  return {
    phoneNumber: nextPhoneNumber,
    businessName: nextBusinessName,
    phoneNumberId: nextPhoneNumberId,
    wabaId: nextWabaId,
    accessToken: nextAccessToken,
    webhookVerifyToken: nextWebhookVerifyToken,
    appSecret: nextAppSecret,
    isActive: nextIsActive,
  };
}

async function createAccount(tenantId, data) {
  const tenant = await ensureTenantExists(tenantId);

  await enforceSingleStoreNumber(tenantId);

  const payload = normalizeCreatePayload(data || {}, tenant);

  validateRequiredPhoneNumber(payload.phoneNumber);
  validateActiveCredentials({
    phoneNumberId: payload.phoneNumberId,
    accessToken: payload.accessToken,
    webhookVerifyToken: payload.webhookVerifyToken,
    isActive: payload.isActive,
  });

  try {
    const created = await prisma.whatsAppAccount.create({
      data: {
        tenantId,
        phoneNumber: payload.phoneNumber,
        businessName: payload.businessName,
        phoneNumberId: payload.phoneNumberId,
        wabaId: payload.wabaId,
        accessToken: payload.accessToken,
        webhookVerifyToken: payload.webhookVerifyToken,
        appSecret: payload.appSecret,
        isActive: payload.isActive,
      },
    });

    return buildPublicAccount(created);
  } catch (err) {
    if (err?.code === "P2002") {
      throw appError("WHATSAPP_ACCOUNT_CONFLICT");
    }

    throw err;
  }
}

async function listAccounts(tenantId) {
  await ensureTenantExists(tenantId);

  const accounts = await prisma.whatsAppAccount.findMany({
    where: { tenantId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return accounts.map(buildPublicAccount);
}

async function getAccount(tenantId, id) {
  await ensureTenantExists(tenantId);

  const account = await prisma.whatsAppAccount.findFirst({
    where: {
      id: String(id),
      tenantId,
    },
  });

  if (!account) {
    throw appError("NOT_FOUND");
  }

  return buildPublicAccount(account);
}

async function updateAccount(tenantId, id, data) {
  await ensureTenantExists(tenantId);

  const existing = await prisma.whatsAppAccount.findFirst({
    where: {
      id: String(id),
      tenantId,
    },
  });

  if (!existing) {
    throw appError("NOT_FOUND");
  }

  await enforceSingleStoreNumber(tenantId, existing.id);

  const payload = normalizeUpdatePayload(data || {}, existing);

  validateRequiredPhoneNumber(payload.phoneNumber);
  validateActiveCredentials({
    phoneNumberId: payload.phoneNumberId,
    accessToken: payload.accessToken,
    webhookVerifyToken: payload.webhookVerifyToken,
    isActive: payload.isActive,
  });

  try {
    const updated = await prisma.whatsAppAccount.update({
      where: { id: existing.id },
      data: {
        phoneNumber: payload.phoneNumber,
        businessName: payload.businessName,
        phoneNumberId: payload.phoneNumberId,
        wabaId: payload.wabaId,
        accessToken: payload.accessToken,
        webhookVerifyToken: payload.webhookVerifyToken,
        appSecret: payload.appSecret,
        isActive: payload.isActive,
      },
    });

    return buildPublicAccount(updated);
  } catch (err) {
    if (err?.code === "P2002") {
      throw appError("WHATSAPP_ACCOUNT_CONFLICT");
    }

    throw err;
  }
}

async function setAccountActive(tenantId, id, isActive) {
  await ensureTenantExists(tenantId);

  const existing = await prisma.whatsAppAccount.findFirst({
    where: {
      id: String(id),
      tenantId,
    },
  });

  if (!existing) {
    throw appError("NOT_FOUND");
  }

  const nextIsActive = normalizeBoolean(isActive, false);

  validateActiveCredentials({
    phoneNumberId: existing.phoneNumberId,
    accessToken: existing.accessToken,
    webhookVerifyToken: existing.webhookVerifyToken,
    isActive: nextIsActive,
  });

  const updated = await prisma.whatsAppAccount.update({
    where: { id: existing.id },
    data: {
      isActive: nextIsActive,
    },
  });

  return buildPublicAccount(updated);
}

module.exports = {
  createAccount,
  listAccounts,
  getAccount,
  updateAccount,
  setAccountActive,
};