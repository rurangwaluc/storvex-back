const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function listAuditLogs(req, res) {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: req.user.tenantId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, role: true } },
      },
      take: 200,
    });

    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch audit logs" });
  }
}

module.exports = { listAuditLogs };
