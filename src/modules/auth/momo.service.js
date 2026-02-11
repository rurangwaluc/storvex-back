const axios = require("axios");
const { randomUUID } = require("crypto");

const BASE_URL = process.env.MOMO_SANDBOX_BASE_URL; // https://sandbox.momodeveloper.mtn.com
const SUBSCRIPTION_KEY = process.env.MOMO_SANDBOX_SUBSCRIPTION_KEY;
const API_USER = process.env.MOMO_API_USER;
const API_KEY = process.env.MOMO_SANDBOX_API_KEY;

// -----------------------------
// GET MOMO ACCESS TOKEN
// -----------------------------
async function getAccessToken() {
  const credentials = Buffer.from(`${API_USER}:${API_KEY}`).toString("base64");

  const response = await axios.post(`${BASE_URL}/collection/token/`, null, {
    headers: {
      Authorization: `Basic ${credentials}`,
      "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY,
      "X-Target-Environment": "sandbox",
    },
  });

  return response.data.access_token;
}

// -----------------------------
// CREATE PAYMENT REQUEST
// -----------------------------
async function createPayment(intentId, amount, phoneNumber) {
  const accessToken = await getAccessToken();

  // IMPORTANT: MTN requires a NEW UUID per payment
  const paymentReference = randomUUID();

  await axios.post(
    `${BASE_URL}/collection/v1_0/requesttopay`,
    {
      amount: amount.toString(),
      currency: process.env.MOMO_CURRENCY || "RWF",
      externalId: intentId, // business reference
      payer: {
        partyIdType: "MSISDN",
        partyId: phoneNumber,
      },
      payerMessage: "Storvex signup",
      payeeNote: "Storvex tenant onboarding",
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-Reference-Id": paymentReference,
        "X-Target-Environment": "sandbox",
        "Ocp-Apim-Subscription-Key": SUBSCRIPTION_KEY,
        "Content-Type": "application/json",
      },
    },
  );

  // Return reference so backend can track it later
  return {
    paymentReference,
    intentId,
  };
}

module.exports = {
  createPayment,
};
