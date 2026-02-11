const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const crypto = require("crypto");

/**
 * STEP 2A — Create MoMo payment request (MOCK)
 * This simulates sending a payment request to MTN MoMo
 */
async function requestMoMoPayment(req, res) {
  try {
    const { intentId, amount } = req.body;

    if (!intentId || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const intent = await prisma.ownerIntent.findUnique({
      where: { id: intentId }
    });

    if (!intent || intent.status !== "PENDING") {
      return res.status(400).json({ message: "Invalid or expired intent" });
    }

    const reference = crypto.randomUUID();

    await prisma.payment.create({
      data: {
        intentId,
        amount,
        reference,
        provider: "MTN_MOMO"
      }
    });

    // ⚠️ MOCK RESPONSE — replace later with MTN API
    return res.json({
      message: "Payment request created",
      reference,
      momoInstructions: "Dial *182# to approve payment (mock)"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Payment request failed" });
  }
}

/**
 * STEP 2B — MoMo Webhook (VERIFICATION ENTRY POINT)
 * This is where MTN MoMo will call us
 */
async function momoWebhook(req, res) {
  try {
    const { reference, status } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { reference }
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (status === "SUCCESS") {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { reference },
          data: { status: "SUCCESS" }
        });

        await tx.ownerIntent.update({
          where: { id: payment.intentId },
          data: { status: "PAID" }
        });
      });
    } else {
      await prisma.payment.update({
        where: { reference },
        data: { status: "FAILED" }
      });
    }

    return res.json({ message: "Webhook processed" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Webhook error" });
  }
}

module.exports = {
  requestMoMoPayment,
  momoWebhook
};
