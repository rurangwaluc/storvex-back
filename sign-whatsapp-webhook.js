const crypto = require("crypto");

const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "your_app_secret_here";

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "test-entry-20260318-1",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "250788959475",
              phone_number_id: "974940309039285"
            },
            contacts: [
              {
                profile: { name: "Luc Test" },
                wa_id: "250785587830"
              }
            ],
            messages: [
              {
                from: "250785587830",
                id: `wamid.TEST_${Date.now()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body: "price a14" },
                type: "text"
              }
            ]
          }
        }
      ]
    }
  ]
};

const rawBody = JSON.stringify(payload);
const signature = crypto
  .createHmac("sha256", APP_SECRET)
  .update(Buffer.from(rawBody))
  .digest("hex");

console.log("RAW_BODY=");
console.log(rawBody);
console.log("");
console.log("X-Hub-Signature-256=");
console.log(`sha256=${signature}`);