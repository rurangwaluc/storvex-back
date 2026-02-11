const { PrismaClient } = require("@prisma/client");
const axios = require("axios");
const prisma = new PrismaClient();

async function initiatePayment(req, res) {
  const { intentId, phone } = req.body;

  if (!intentId || !phone) {
    return res.status(400).json({ message: "Missing fields" });
  }

  const intent = await prisma.ownerIntent.findUnique({
    where: { id: intentId },
  });

  if (!intent || intent.status !== "PENDING") {
    return res.status(400).json({ message: "Invalid intent" });
  }

  const reference = `PAY-${Date.now()}`;

  await prisma.payment.create({
    data: {
      intentId,
      amount: 5000, // example plan price
      reference,
      provider: "MTN_MOMO",
    },
  });

  // 🔔 MTN MoMo requestToPay
  await axios.post(
    process.env.MOMO_REQUEST_URL,
    {
      amount: "5000",
      currency: "RWF",
      externalId: reference,
      payer: { partyIdType: "MSISDN", partyId: phone },
      payerMessage: "Storvex subscription",
      payeeNote: "Tenant onboarding",
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MOMO_TOKEN}`,
        "X-Reference-Id": reference,
        "X-Target-Environment": "sandbox",
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": process.env.MOMO_SUB_KEY,
      },
    },
  );

  res.json({ message: "Payment initiated" });
}

module.exports = { initiatePayment };
