// src/utils/auditLogger.js
const prisma = require("../config/database");

// ✅ Prisma v5/v6 safest way: read enums from Prisma namespace
const { Prisma } = require("@prisma/client");

// These may be undefined depending on Prisma build/export style.
// So we must NOT call Object.values on undefined.
const AUDIT_ACTION_ENUM = Prisma?.AuditAction;
const AUDIT_ENTITY_ENUM = Prisma?.AuditEntity;

// Strict allowlists (only if enums exist)
const ALLOWED_ACTIONS = AUDIT_ACTION_ENUM ? new Set(Object.values(AUDIT_ACTION_ENUM)) : null;
const ALLOWED_ENTITIES = AUDIT_ENTITY_ENUM ? new Set(Object.values(AUDIT_ENTITY_ENUM)) : null;

async function logAudit({ tenantId, userId, action, entity, entityId = null, metadata = null }) {
  if (!tenantId || !entity || !action) {
    console.error("Audit log rejected: missing tenantId/entity/action", {
      tenantId,
      entity,
      action,
    });
    return;
  }

  // ✅ Validate ONLY if enums are available (prevents server crash)
  if (ALLOWED_ENTITIES && !ALLOWED_ENTITIES.has(entity)) {
    console.error("Audit log rejected invalid entity:", entity, {
      allowed: Array.from(ALLOWED_ENTITIES),
    });
    return;
  }

  if (ALLOWED_ACTIONS && !ALLOWED_ACTIONS.has(action)) {
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
        action,
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