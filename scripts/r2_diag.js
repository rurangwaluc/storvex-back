// scripts/r2_diag.js
require("dotenv").config();

const { S3Client, ListBucketsCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return String(v).trim();
}

(async () => {
  const accountId = mustEnv("R2_ACCOUNT_ID");
  const bucket = mustEnv("R2_BUCKET");
  const accessKeyId = mustEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = mustEnv("R2_SECRET_ACCESS_KEY");

  console.log("R2_ACCOUNT_ID:", accountId);
  console.log("R2_BUCKET:", bucket);
  console.log("R2_ACCESS_KEY_ID prefix:", accessKeyId.slice(0, 6), "len:", accessKeyId.length);
  console.log("R2_SECRET_ACCESS_KEY len:", secretAccessKey.length);

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  try {
    // This proves whether credentials are valid at all
    const res = await client.send(new ListBucketsCommand({}));
    console.log("✅ ListBuckets OK. buckets:", (res.Buckets || []).map(b => b.Name));
  } catch (e) {
    console.error("❌ ListBuckets failed:", e?.name, e?.Code || "", e?.message || e);
    process.exit(1);
  }

  try {
    // This proves bucket name is correct and accessible
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log("✅ HeadBucket OK for:", bucket);
  } catch (e) {
    console.error("❌ HeadBucket failed:", e?.name, e?.Code || "", e?.message || e);
    process.exit(1);
  }

  console.log("✅ Credentials + bucket are correct. You can upload now.");
})();