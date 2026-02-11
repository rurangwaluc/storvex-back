// ✅ Fully fixed: src/utils/auditLogger.js
const { PrismaClient, AuditAction } = require("@prisma/client");

const prisma = new PrismaClient();

// Strict allowlist: ONLY allow schema enum values
const ALLOWED_ACTIONS = new Set(Object.values(AuditAction));

async function logAudit({
  tenantId,
  userId,
  action,
  entity,
  entityId = null,
  metadata = null,
}) {
  // Required fields
  if (!tenantId || !entity) {
    console.error("Audit log rejected: missing tenantId/entity", { tenantId, entity });
    return;
  }

  // Enforce enum value
  if (!ALLOWED_ACTIONS.has(action)) {
    console.error("Audit log rejected invalid action:", action, {
      allowed: Array.from(ALLOWED_ACTIONS),
    });
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: userId || null,
        action, // stored as string in DB, enforced here
        entity,
        entityId,
        metadata,
      },
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}

module.exports = logAudit;