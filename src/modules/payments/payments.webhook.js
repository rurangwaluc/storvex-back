const prisma = require("../../config/database");

async function momoWebhook(req, res) {
  const { referenceId, status } = req.body;

  if (status !== "SUCCESSFUL") {
    return res.sendStatus(200);
  }

  const payment = await prisma.payment.findUnique({
    where: { reference: referenceId },
  });

  if (!payment) return res.sendStatus(404);

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCESS" },
    });

    await tx.ownerIntent.update({
      where: { id: payment.intentId },
      data: { status: "PAID" },
    });
  });

  res.sendStatus(200);
}

module.exports = { momoWebhook };
