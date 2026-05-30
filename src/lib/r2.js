const crypto = require("crypto");

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const R2_ACCOUNT_ID = requiredEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requiredEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requiredEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = requiredEnv("R2_BUCKET");

const R2_REGION = String(process.env.R2_REGION || "auto").trim();

const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const R2_SIGNED_URL_TTL_SECONDS = Number(
  process.env.R2_SIGNED_URL_TTL_SECONDS || 300
);

const r2 = new S3Client({
  region: R2_REGION,
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

function safeSignedUrlTtl() {
  return Number.isFinite(R2_SIGNED_URL_TTL_SECONDS) &&
    R2_SIGNED_URL_TTL_SECONDS > 0
    ? R2_SIGNED_URL_TTL_SECONDS
    : 300;
}

function cleanStorageKey(value) {
  return String(value || "").trim().replace(/^\/+/, "");
}

function safeFileName(value) {
  return String(value || "file")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function buildSupportStorageKey({ tenantId, fileName }) {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomUUID();

  return [
    "support",
    tenantId,
    year,
    month,
    `${id}-${safeFileName(fileName)}`,
  ].join("/");
}

function buildPublicFileUrl(storageKey) {
  const key = cleanStorageKey(storageKey);

  if (!R2_PUBLIC_BASE_URL || !key) {
    return null;
  }

  return `${R2_PUBLIC_BASE_URL}/${key}`;
}

async function createSupportUploadUrl({ tenantId, fileName, fileType }) {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  if (!fileName) {
    throw new Error("fileName is required");
  }

  if (!fileType) {
    throw new Error("fileType is required");
  }

  const storageKey = buildSupportStorageKey({
    tenantId,
    fileName,
  });

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storageKey,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(r2, command, {
    expiresIn: safeSignedUrlTtl(),
  });

  return {
    uploadUrl,
    storageKey,
    fileUrl: buildPublicFileUrl(storageKey),
  };
}

async function createSignedDownloadUrl(storageKey) {
  const key = cleanStorageKey(storageKey);

  if (!key) {
    throw new Error("storageKey is required");
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });

  return getSignedUrl(r2, command, {
    expiresIn: safeSignedUrlTtl(),
  });
}

module.exports = {
  r2,
  createSupportUploadUrl,
  createSignedDownloadUrl,
  buildSupportStorageKey,
  buildPublicFileUrl,
  cleanStorageKey,
};