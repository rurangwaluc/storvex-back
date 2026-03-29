const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function getEnv(name) {
  return String(process.env[name] || "").trim();
}

function isConfigured() {
  return Boolean(
    getEnv("OBJECT_STORAGE_BUCKET") &&
    getEnv("OBJECT_STORAGE_ENDPOINT") &&
    getEnv("OBJECT_STORAGE_ACCESS_KEY_ID") &&
    getEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY")
  );
}

function getClient() {
  if (!isConfigured()) return null;

  return new S3Client({
    region: getEnv("OBJECT_STORAGE_REGION") || "auto",
    endpoint: getEnv("OBJECT_STORAGE_ENDPOINT"),
    forcePathStyle: false,
    credentials: {
      accessKeyId: getEnv("OBJECT_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: getEnv("OBJECT_STORAGE_SECRET_ACCESS_KEY"),
    },
  });
}

function buildPublicUrl(key) {
  const base = getEnv("OBJECT_STORAGE_PUBLIC_BASE_URL");
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${key}`;
}

async function createPresignedImageUpload({
  key,
  contentType,
  expiresInSeconds = 900,
}) {
  const client = getClient();
  if (!client) {
    const err = new Error("Object storage is not configured");
    err.status = 503;
    throw err;
  }

  const bucket = getEnv("OBJECT_STORAGE_BUCKET");

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, cmd, {
    expiresIn: expiresInSeconds,
  });

  return {
    uploadUrl,
    publicUrl: buildPublicUrl(key),
    objectKey: key,
    headers: {
      "Content-Type": contentType,
    },
  };
}

module.exports = {
  isConfigured,
  createPresignedImageUpload,
};