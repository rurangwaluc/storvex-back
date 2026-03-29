const prisma = require("../../config/database");

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

/**
 * Resolve effective permissions for a user:
 * 1) Start with role permissions
 * 2) Apply user-specific overrides
 *    - isGranted=true  => force add
 *    - isGranted=false => force remove
 *
 * Returns string[] permission keys
 */
async function resolveEffectiveDbPermissions({ userId, role }) {
  const normalizedRole = normalizeRole(role);
  const safeUserId = String(userId || "").trim();

  if (!normalizedRole || !safeUserId) return [];

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
      where: { userId: safeUserId },
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
    roleRows
      .map((row) => row?.permission?.key)
      .filter(Boolean)
  );

  for (const row of userRows) {
    const key = row?.permission?.key;
    if (!key) continue;

    if (row.isGranted) effective.add(key);
    else effective.delete(key);
  }

  return Array.from(effective).sort();
}

module.exports = {
  resolveEffectiveDbPermissions,
};