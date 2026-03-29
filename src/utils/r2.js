// src/utils/r2.js
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function getR2Client() {
  const accountId = mustEnv("R2_ACCOUNT_ID");
  const accessKeyId = mustEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = mustEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

async function signGetUrl(key, ttlSeconds) {
  if (!key) return null;
  const Bucket = mustEnv("R2_BUCKET");
  const client = getR2Client();
  const cmd = new GetObjectCommand({ Bucket, Key: key });

  const ttl =
    Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
      ? Number(ttlSeconds)
      : Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 300);

  return getSignedUrl(client, cmd, { expiresIn: ttl });
}

async function signPutUrl(key, contentType, ttlSeconds) {
  if (!key) throw new Error("Missing key");
  const Bucket = mustEnv("R2_BUCKET");
  const client = getR2Client();

  const cmd = new PutObjectCommand({
    Bucket,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  });

  const ttl =
    Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds) > 0
      ? Number(ttlSeconds)
      : Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 300);

  return getSignedUrl(client, cmd, { expiresIn: ttl });
}

async function deleteObject(key) {
  if (!key) return;
  const Bucket = mustEnv("R2_BUCKET");
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

module.exports = { signGetUrl, signPutUrl, deleteObject, getR2Client };