const prisma = require("../../config/database");

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
  if (value == null) return fallback;
  return Boolean(value);
}

function maskSecret(value) {
  return value ? "********" : null;
}

function buildPublicAccount(account) {
  if (!account) return null;

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
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function resolveFinalValue(nextValue, existingValue) {
  if (nextValue === undefined) return existingValue;
  return nextValue;
}

function validateRequiredPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    throw new Error("PHONE_NUMBER_REQUIRED");
  }

  if (String(phoneNumber).length < 8) {
    throw new Error("PHONE_NUMBER_INVALID");
  }
}

function validateActiveCredentials({
  phoneNumberId,
  accessToken,
  isActive,
}) {
  if (!isActive) return;

  if (!normalizeStr(phoneNumberId)) {
    throw new Error("PHONE_NUMBER_ID_REQUIRED_WHEN_ACTIVE");
  }

  if (!normalizeStr(accessToken)) {
    throw new Error("ACCESS_TOKEN_REQUIRED_WHEN_ACTIVE");
  }
}

async function ensureTenantExists(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }
}

async function createAccount(tenantId, data) {
  await ensureTenantExists(tenantId);

  const phoneNumber = normalizePhone(data?.phoneNumber);
  const businessName = normalizeStr(data?.businessName);
  const phoneNumberId = normalizeStr(data?.phoneNumberId);
  const wabaId = normalizeStr(data?.wabaId);
  const accessToken = normalizeStr(data?.accessToken);
  const webhookVerifyToken = normalizeStr(data?.webhookVerifyToken);
  const appSecret = normalizeStr(data?.appSecret);
  const isActive = normalizeBoolean(data?.isActive, true);

  validateRequiredPhoneNumber(phoneNumber);
  validateActiveCredentials({
    phoneNumberId,
    accessToken,
    isActive,
  });

  const created = await prisma.whatsAppAccount.create({
    data: {
      tenantId,
      phoneNumber,
      businessName,
      phoneNumberId,
      wabaId,
      accessToken,
      webhookVerifyToken,
      appSecret,
      isActive,
    },
  });

  return buildPublicAccount(created);
}

async function listAccounts(tenantId) {
  await ensureTenantExists(tenantId);

  const accounts = await prisma.whatsAppAccount.findMany({
    where: { tenantId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return accounts.map(buildPublicAccount);
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
    throw new Error("NOT_FOUND");
  }

  const nextPhoneNumber = resolveFinalValue(
    data?.phoneNumber !== undefined ? normalizePhone(data.phoneNumber) : undefined,
    existing.phoneNumber
  );

  const nextBusinessName = resolveFinalValue(
    data?.businessName !== undefined ? normalizeStr(data.businessName) : undefined,
    existing.businessName
  );

  const nextPhoneNumberId = resolveFinalValue(
    data?.phoneNumberId !== undefined ? normalizeStr(data.phoneNumberId) : undefined,
    existing.phoneNumberId
  );

  const nextWabaId = resolveFinalValue(
    data?.wabaId !== undefined ? normalizeStr(data.wabaId) : undefined,
    existing.wabaId
  );

  const nextAccessToken = resolveFinalValue(
    data?.accessToken !== undefined ? normalizeStr(data.accessToken) : undefined,
    existing.accessToken
  );

  const nextWebhookVerifyToken = resolveFinalValue(
    data?.webhookVerifyToken !== undefined
      ? normalizeStr(data.webhookVerifyToken)
      : undefined,
    existing.webhookVerifyToken
  );

  const nextAppSecret = resolveFinalValue(
    data?.appSecret !== undefined ? normalizeStr(data.appSecret) : undefined,
    existing.appSecret
  );

  const nextIsActive = resolveFinalValue(
    data?.isActive !== undefined ? normalizeBoolean(data.isActive, false) : undefined,
    Boolean(existing.isActive)
  );

  validateRequiredPhoneNumber(nextPhoneNumber);
  validateActiveCredentials({
    phoneNumberId: nextPhoneNumberId,
    accessToken: nextAccessToken,
    isActive: nextIsActive,
  });

  const updated = await prisma.whatsAppAccount.update({
    where: { id: existing.id },
    data: {
      phoneNumber: nextPhoneNumber,
      businessName: nextBusinessName,
      phoneNumberId: nextPhoneNumberId,
      wabaId: nextWabaId,
      accessToken: nextAccessToken,
      webhookVerifyToken: nextWebhookVerifyToken,
      appSecret: nextAppSecret,
      isActive: nextIsActive,
    },
  });

  return buildPublicAccount(updated);
}

module.exports = {
  createAccount,
  listAccounts,
  updateAccount,
};