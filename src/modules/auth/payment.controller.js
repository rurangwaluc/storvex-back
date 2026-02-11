const prisma = require("../../config/database");

/**
 * Real webhook callback (keep for future)
 * This expects whatever MTN sends. If payload is wrong, it fails safely.
 */
async function momoCallback(req, res) {
  try {
    // Many MoMo callbacks are not standardized; keep this strict.
    // For now, just acknowledge receipt.
    return res.status(200).json({ message: "Webhook received" });
  } catch (err) {
    console.error("momoCallback error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}

/**
 * DEV ONLY: simulate a successful MoMo payment
 * Body:
 * {
 *   "intentId": "<ownerIntentId>",
 *   "reference": "<paymentReference UUID>",
 *   "amount": 10000,
 *   "provider": "MOMO"
 * }
 */
async function momoCallbackDev(req, res) {
  try {
    const { intentId, reference, amount, provider } = req.body;

    if (!intentId || !reference) {
      return res.status(400).json({
        message: "intentId and reference are required",
      });
    }

    const intent = await prisma.ownerIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      return res.status(404).json({ message: "OwnerIntent not found" });
    }

    // Upsert payment for this intent+reference
    const payment = await prisma.payment.upsert({
      where: { reference }, // your Payment model has reference @unique
      update: {
        status: "SUCCESS",
        amount: amount ? Number(amount) : undefined,
        provider: provider || "MOMO",
      },
      create: {
        intentId,
        reference,
        amount: amount ? Number(amount) : 0,
        currency: "EUR", // dev/sandbox, can be env later
        status: "SUCCESS",
        provider: provider || "MOMO",
      },
    });

    // Mark intent paid
    const updatedIntent = await prisma.ownerIntent.update({
      where: { id: intentId },
      data: {
        status: "PAID",
        convertedAt: new Date(),
      },
    });

    return res.json({
      message:
        "Dev callback processed: payment marked SUCCESSFUL and intent PAID",
      payment,
      intent: {
        id: updatedIntent.id,
        status: updatedIntent.status,
        convertedAt: updatedIntent.convertedAt,
      },
    });
  } catch (err) {
    console.error("momoCallbackDev error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
}

module.exports = {
  momoCallback,
  momoCallbackDev,
};
