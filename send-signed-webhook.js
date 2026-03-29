// send-signed-webhook.js
// Usage examples:
// WHATSAPP_APP_SECRET="your_secret_here" node send-signed-webhook.js "price a14"
// WHATSAPP_APP_SECRET="your_secret_here" node send-signed-webhook.js "BUY Samsung Galaxy A14"
// WHATSAPP_APP_SECRET="your_secret_here" node send-signed-webhook.js "PAY 30000 MOMO TX9003"

const crypto = require("crypto");
const axios = require("axios");

const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:5000/api/whatsapp/webhook";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "974940309039285";
const CUSTOMER_PHONE = process.env.CUSTOMER_PHONE || "250785587830";
const DISPLAY_PHONE_NUMBER = process.env.DISPLAY_PHONE_NUMBER || "250788959475";

if (!WHATSAPP_APP_SECRET) {
  console.error("Missing WHATSAPP_APP_SECRET");
  process.exit(1);
}

function uniqueMessageId(prefix = "TEST") {
  return `wamid.${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function unixTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function buildPayload(customerText = "price a14") {
  const text = String(customerText || "").trim() || "price a14";
  const lower = text.toLowerCase();

  let prefix = "TEST";
  if (lower.startsWith("buy ")) prefix = "BUY";
  else if (lower.startsWith("pay ")) prefix = "PAY";
  else if (lower.includes("price") || lower.includes("stock")) prefix = "QUERY";

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: `test-entry-${Date.now()}`,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: DISPLAY_PHONE_NUMBER,
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: "Test User" },
                  wa_id: CUSTOMER_PHONE,
                },
              ],
              messages: [
                {
                  from: CUSTOMER_PHONE,
                  id: uniqueMessageId(prefix),
                  timestamp: unixTimestamp(),
                  text: { body: text },
                  type: "text",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function signRawBody(rawBodyBuffer) {
  const hash = crypto
    .createHmac("sha256", WHATSAPP_APP_SECRET)
    .update(rawBodyBuffer)
    .digest("hex");

  return `sha256=${hash}`;
}

async function sendWebhook(customerText) {
  const payload = buildPayload(customerText);
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = signRawBody(rawBody);

  console.log("Sending message:");
  console.log(customerText);
  console.log("");
  console.log("Message ID:");
  console.log(payload.entry[0].changes[0].value.messages[0].id);
  console.log("");

  try {
    const res = await axios.post(WEBHOOK_URL, rawBody, {
      headers: {
        "X-Hub-Signature-256": signature,
        "Content-Type": "application/json",
      },
    });

    console.log("Webhook sent. Status:", res.status);
  } catch (err) {
    console.error("Failed to send webhook:", err.response?.data || err.message);
  }
}

(async () => {
  const customerText = process.argv.slice(2).join(" ").trim() || "price a14";
  await sendWebhook(customerText);
})();