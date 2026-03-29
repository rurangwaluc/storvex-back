// scripts/r2_put_test.js
require("dotenv").config();

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v.trim();
}

async function main() {
  const accountId = mustEnv("R2_ACCOUNT_ID");
  const bucket = mustEnv("R2_BUCKET");
  const accessKeyId = mustEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = mustEnv("R2_SECRET_ACCESS_KEY");

  console.log("AK len:", accessKeyId.length);
  console.log("SK len:", secretAccessKey.length);
  console.log("bucket:", bucket);
  console.log("endpoint:", `https://${accountId}.r2.cloudflarestorage.com`);

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  const key = `tests/hello_${Date.now()}.txt`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from("hello r2\n"),
      ContentType: "text/plain",
    })
  );

  console.log("✅ PutObject ok:", { bucket, key });
}

main().catch((e) => {
  console.error("❌ PutObject failed:", e?.name, e?.Code || e?.code, e?.message);
  process.exit(1);
});