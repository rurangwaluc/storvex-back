// scripts/r2_bucket_diag.js
require("dotenv").config();

const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return String(v).trim();
}

function dumpAwsError(label, e) {
  console.error(`\n❌ ${label}`);
  console.error("name:", e?.name);
  console.error("Code:", e?.Code);
  console.error("message:", e?.message);
  console.error("httpStatusCode:", e?.$metadata?.httpStatusCode);
  console.error("requestId:", e?.$metadata?.requestId);
  console.error("cfId:", e?.$metadata?.cfId);
  console.error("fault:", e?.$fault);
  console.error("raw:", e);
  console.error("");
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

    // IMPORTANT for R2: avoid extra checksum signing issues in some setups
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  // 1) Try upload (this is the real permission test)
  const key = `tests/diag_${Date.now()}.txt`;
  const body = Buffer.from("hello r2\n");

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "text/plain",
      })
    );
    console.log("✅ PutObject OK:", `${bucket}/${key}`);
  } catch (e) {
    dumpAwsError("PutObject failed", e);

    // if PutObject fails, HeadObject won't matter
    process.exit(1);
  }

  // 2) Confirm it exists
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.log("✅ HeadObject OK:", `${bucket}/${key}`);
  } catch (e) {
    dumpAwsError("HeadObject failed", e);
    process.exit(1);
  }

  console.log("\n✅ R2 is working for this bucket (write + read).");
})();