const prisma = require("../../config/database");

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

/**
 * Owner is the tenant super-admin.
 * In a serious retail control system, OWNER must never depend on seed completeness.
 */
function ownerPermissionSet() {
  return ["*"];
}

/**
 * Resolve effective permissions for a user:
 * 1) Start with role permissions from DB
 * 2) Apply user-specific overrides
 *    - isGranted=true  => force add
 *    - isGranted=false => force remove
 *
 * Returns string[] permission keys
 *
 * Important:
 * - UserPermission does NOT have tenantId in schema, so never filter on tenantId here.
 * - Tenant safety is already implicit because userId belongs to one tenant user record.
 */
async function resolveEffectiveDbPermissions({ userId, role }) {
  const normalizedRole = normalizeRole(role);
  const safeUserId = String(userId || "").trim();

  if (!normalizedRole || !safeUserId) return [];

  // OWNER bypass: never rely on DB seed completeness for owner access
  if (normalizedRole === "OWNER") {
    return ownerPermissionSet();
  }

  const [roleRows, userRows] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { role: normalizedRole },
      select: {
        permission: {
          select: {
            key: true,
          },
        },
      },
    }),

    prisma.userPermission.findMany({
      where: {
        userId: safeUserId,
      },
      select: {
        isGranted: true,
        permission: {
          select: {
            key: true,
          },
        },
      },
    }),
  ]);

  const effective = new Set(
    roleRows.map((row) => row?.permission?.key).filter(Boolean)
  );

  for (const row of userRows) {
    const key = row?.permission?.key;
    if (!key) continue;

    if (row.isGranted === true) {
      effective.add(key);
    } else if (row.isGranted === false) {
      effective.delete(key);
    }
  }

  return Array.from(effective).sort();
}

module.exports = {
  resolveEffectiveDbPermissions,
};