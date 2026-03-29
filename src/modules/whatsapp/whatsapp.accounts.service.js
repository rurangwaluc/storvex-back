const prisma = require("../../config/database");

function normalizeStr(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizePhone(value) {
  return normalizeStr(value);
}

function normalizeBoolean(value, fallback = null) {
  if (value == null) return fallback;
  return Boolean(value);
}

function assertActiveCredentials(data, existing = null) {
  const finalIsActive =
    data?.isActive == null
      ? existing?.isActive == null
        ? true
        : Boolean(existing.isActive)
      : Boolean(data.isActive);

  if (!finalIsActive) return;

  const phoneNumberId = normalizeStr(
    data?.phoneNumberId != null ? data.phoneNumberId : existing?.phoneNumberId
  );
  if (!phoneNumberId) {
    throw new Error("phoneNumberId required when isActive=true");
  }

  const accessToken = normalizeStr(
    data?.accessToken != null ? data.accessToken : existing?.accessToken
  );
  if (!accessToken) {
    throw new Error("accessToken required when isActive=true");
  }
}

function toPublicAccount(account) {
  if (!account) return null;

  return {
    id: account.id,
    tenantId: account.tenantId,
    phoneNumber: account.phoneNumber,
    businessName: account.businessName,
    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,
    webhookVerifyToken: account.webhookVerifyToken ? "********" : null,
    appSecret: account.appSecret ? "********" : null,
    hasAccessToken: Boolean(account.accessToken),
    isActive: account.isActive,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

async function createAccount(tenantId, data) {
  const phoneNumber = normalizePhone(data?.phoneNumber);
  if (!phoneNumber) throw new Error("phoneNumber required");

  assertActiveCredentials(data);

  const created = await prisma.whatsAppAccount.create({
    data: {
      tenantId,
      phoneNumber,
      businessName: normalizeStr(data?.businessName),
      phoneNumberId: normalizeStr(data?.phoneNumberId),
      wabaId: normalizeStr(data?.wabaId),
      accessToken: normalizeStr(data?.accessToken),
      webhookVerifyToken: normalizeStr(data?.webhookVerifyToken),
      appSecret: normalizeStr(data?.appSecret),
      isActive: data?.isActive == null ? true : Boolean(data.isActive),
    },
  });

  return toPublicAccount(created);
}

async function listAccounts(tenantId) {
  const accounts = await prisma.whatsAppAccount.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  return accounts.map(toPublicAccount);
}

async function updateAccount(tenantId, id, data) {
  const existing = await prisma.whatsAppAccount.findFirst({
    where: { id: String(id), tenantId },
  });

  if (!existing) throw new Error("NOT_FOUND");

  assertActiveCredentials(data, existing);

  const updated = await prisma.whatsAppAccount.update({
    where: { id: existing.id },
    data: {
      businessName: data?.businessName != null ? normalizeStr(data.businessName) : undefined,
      phoneNumber: data?.phoneNumber != null ? normalizePhone(data.phoneNumber) : undefined,
      phoneNumberId: data?.phoneNumberId != null ? normalizeStr(data.phoneNumberId) : undefined,
      wabaId: data?.wabaId != null ? normalizeStr(data.wabaId) : undefined,
      accessToken: data?.accessToken != null ? normalizeStr(data.accessToken) : undefined,
      webhookVerifyToken:
        data?.webhookVerifyToken != null ? normalizeStr(data.webhookVerifyToken) : undefined,
      appSecret: data?.appSecret != null ? normalizeStr(data.appSecret) : undefined,
      isActive: data?.isActive != null ? Boolean(data.isActive) : undefined,
    },
  });

  return toPublicAccount(updated);
}

module.exports = {
  createAccount,
  listAccounts,
  updateAccount,
};