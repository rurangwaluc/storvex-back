const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");
const { PlatformRole } = require("@prisma/client");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeEmail(value) {
  const s = cleanString(value);
  return s ? s.toLowerCase() : null;
}

function getPlatformUser(req) {
  return req.platformUser || req.user || null;
}

function getPlatformRole(req) {
  return String(getPlatformUser(req)?.role || "").toUpperCase();
}

function getPlatformUserId(req) {
  return getPlatformUser(req)?.id || getPlatformUser(req)?.userId || null;
}

function isPlatformOwner(req) {
  return getPlatformRole(req) === "PLATFORM_OWNER";
}

function normalizePlatformRole(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return null;
  return Object.values(PlatformRole).includes(raw) ? raw : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;

  const raw = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "active", "enabled"].includes(raw)) return true;
  if (["false", "0", "no", "inactive", "disabled"].includes(raw)) return false;

  return fallback;
}

function platformUserSelect() {
  return {
    id: true,
    name: true,
    email: true,
    role: true,
    isActive: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  };
}

function safePlatformUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: Boolean(user.isActive),
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function canManageTargetRole(actorRole, targetRole) {
  if (actorRole !== "PLATFORM_OWNER") return false;

  // Owner can manage every platform role, including other admins/support users.
  // Self-protection is handled separately.
  return Object.values(PlatformRole).includes(targetRole);
}

async function listPlatformUsers(req, res) {
  try {
    const q = String(req.query?.q || "").trim();
    const role = normalizePlatformRole(req.query?.role);
    const includeInactive =
      String(req.query?.includeInactive || "").trim().toLowerCase() === "true";

    const takeRaw = Number(req.query?.take || 50);
    const skipRaw = Number(req.query?.skip || 0);

    const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), 100) : 50;
    const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

    const where = {
      ...(includeInactive ? {} : { isActive: true }),
      ...(role ? { role } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [rows, count] = await Promise.all([
      prisma.platformUser.findMany({
        where,
        orderBy: [{ role: "asc" }, { createdAt: "desc" }],
        skip,
        take,
        select: platformUserSelect(),
      }),
      prisma.platformUser.count({ where }),
    ]);

    return res.json({
      platformUsers: rows.map(safePlatformUser),
      count,
      page: {
        skip,
        take,
        returned: rows.length,
        hasMore: skip + rows.length < count,
      },
    });
  } catch (err) {
    console.error("listPlatformUsers error:", err);
    return res.status(500).json({
      message: "Failed to load platform users",
      code: "PLATFORM_USERS_LIST_FAILED",
    });
  }
}

async function getPlatformUserById(req, res) {
  const id = cleanString(req.params?.id);

  if (!id) {
    return res.status(400).json({
      message: "Platform user id is required",
      code: "PLATFORM_USER_ID_REQUIRED",
    });
  }

  try {
    const user = await prisma.platformUser.findUnique({
      where: { id },
      select: platformUserSelect(),
    });

    if (!user) {
      return res.status(404).json({
        message: "Platform user not found",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    return res.json({
      platformUser: safePlatformUser(user),
    });
  } catch (err) {
    console.error("getPlatformUserById error:", err);
    return res.status(500).json({
      message: "Failed to load platform user",
      code: "PLATFORM_USER_DETAIL_FAILED",
    });
  }
}

async function createPlatformUser(req, res) {
  if (!isPlatformOwner(req)) {
    return res.status(403).json({
      message: "Only platform owner can create platform users",
      code: "PLATFORM_OWNER_REQUIRED",
    });
  }

  const name = cleanString(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const role = normalizePlatformRole(req.body?.role) || PlatformRole.PLATFORM_SUPPORT;

  if (!name || !email || !password) {
    return res.status(400).json({
      message: "name, email, and password are required",
      code: "PLATFORM_USER_FIELDS_REQUIRED",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: "Password must be at least 8 characters",
      code: "PASSWORD_TOO_SHORT",
    });
  }

  if (!canManageTargetRole(getPlatformRole(req), role)) {
    return res.status(403).json({
      message: "You cannot create a platform user with this role",
      code: "PLATFORM_ROLE_DENIED",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const created = await prisma.platformUser.create({
      data: {
        name,
        email,
        passwordHash,
        role,
        isActive: true,
      },
      select: platformUserSelect(),
    });

    return res.status(201).json({
      message: "Platform user created",
      platformUser: safePlatformUser(created),
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "A platform user with this email already exists",
        code: "PLATFORM_USER_EMAIL_EXISTS",
      });
    }

    console.error("createPlatformUser error:", err);
    return res.status(500).json({
      message: "Failed to create platform user",
      code: "PLATFORM_USER_CREATE_FAILED",
    });
  }
}

async function updatePlatformUserRole(req, res) {
  if (!isPlatformOwner(req)) {
    return res.status(403).json({
      message: "Only platform owner can change platform user roles",
      code: "PLATFORM_OWNER_REQUIRED",
    });
  }

  const id = cleanString(req.params?.id);
  const nextRole = normalizePlatformRole(req.body?.role);
  const currentUserId = getPlatformUserId(req);

  if (!id) {
    return res.status(400).json({
      message: "Platform user id is required",
      code: "PLATFORM_USER_ID_REQUIRED",
    });
  }

  if (!nextRole) {
    return res.status(400).json({
      message: `role must be one of ${Object.values(PlatformRole).join(", ")}`,
      code: "INVALID_PLATFORM_ROLE",
    });
  }

  if (id === currentUserId && nextRole !== PlatformRole.PLATFORM_OWNER) {
    return res.status(400).json({
      message: "You cannot remove your own platform owner role",
      code: "CANNOT_DEMOTE_SELF",
    });
  }

  try {
    const existing = await prisma.platformUser.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Platform user not found",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    const updated = await prisma.platformUser.update({
      where: { id },
      data: { role: nextRole },
      select: platformUserSelect(),
    });

    return res.json({
      message: "Platform user role updated",
      platformUser: safePlatformUser(updated),
    });
  } catch (err) {
    console.error("updatePlatformUserRole error:", err);
    return res.status(500).json({
      message: "Failed to update platform user role",
      code: "PLATFORM_USER_ROLE_UPDATE_FAILED",
    });
  }
}

async function updatePlatformUserStatus(req, res) {
  if (!isPlatformOwner(req)) {
    return res.status(403).json({
      message: "Only platform owner can activate or deactivate platform users",
      code: "PLATFORM_OWNER_REQUIRED",
    });
  }

  const id = cleanString(req.params?.id);
  const currentUserId = getPlatformUserId(req);
  const isActive = normalizeBoolean(req.body?.isActive, true);

  if (!id) {
    return res.status(400).json({
      message: "Platform user id is required",
      code: "PLATFORM_USER_ID_REQUIRED",
    });
  }

  if (id === currentUserId && isActive === false) {
    return res.status(400).json({
      message: "You cannot deactivate your own platform account",
      code: "CANNOT_DEACTIVATE_SELF",
    });
  }

  try {
    const existing = await prisma.platformUser.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Platform user not found",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    const updated = await prisma.platformUser.update({
      where: { id },
      data: { isActive },
      select: platformUserSelect(),
    });

    return res.json({
      message: isActive ? "Platform user activated" : "Platform user deactivated",
      platformUser: safePlatformUser(updated),
    });
  } catch (err) {
    console.error("updatePlatformUserStatus error:", err);
    return res.status(500).json({
      message: "Failed to update platform user status",
      code: "PLATFORM_USER_STATUS_UPDATE_FAILED",
    });
  }
}

async function resetPlatformUserPassword(req, res) {
  if (!isPlatformOwner(req)) {
    return res.status(403).json({
      message: "Only platform owner can reset platform user passwords",
      code: "PLATFORM_OWNER_REQUIRED",
    });
  }

  const id = cleanString(req.params?.id);
  const password = String(req.body?.password || "");

  if (!id) {
    return res.status(400).json({
      message: "Platform user id is required",
      code: "PLATFORM_USER_ID_REQUIRED",
    });
  }

  if (!password) {
    return res.status(400).json({
      message: "password is required",
      code: "PASSWORD_REQUIRED",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: "Password must be at least 8 characters",
      code: "PASSWORD_TOO_SHORT",
    });
  }

  try {
    const existing = await prisma.platformUser.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Platform user not found",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.platformUser.update({
      where: { id },
      data: { passwordHash },
      select: platformUserSelect(),
    });

    return res.json({
      message: "Platform user password reset",
      platformUser: safePlatformUser(updated),
    });
  } catch (err) {
    console.error("resetPlatformUserPassword error:", err);
    return res.status(500).json({
      message: "Failed to reset platform user password",
      code: "PLATFORM_USER_PASSWORD_RESET_FAILED",
    });
  }
}

async function updateMyPlatformProfile(req, res) {
  const currentUserId = getPlatformUserId(req);
  const name = cleanString(req.body?.name);
  const email = normalizeEmail(req.body?.email);

  if (!currentUserId) {
    return res.status(401).json({
      message: "Unauthorized",
      code: "PLATFORM_AUTH_REQUIRED",
    });
  }

  if (!name && !email) {
    return res.status(400).json({
      message: "name or email is required",
      code: "NO_PROFILE_FIELDS",
    });
  }

  try {
    const updated = await prisma.platformUser.update({
      where: { id: currentUserId },
      data: {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
      },
      select: platformUserSelect(),
    });

    return res.json({
      message: "Platform profile updated",
      platformUser: safePlatformUser(updated),
    });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({
        message: "A platform user with this email already exists",
        code: "PLATFORM_USER_EMAIL_EXISTS",
      });
    }

    console.error("updateMyPlatformProfile error:", err);
    return res.status(500).json({
      message: "Failed to update platform profile",
      code: "PLATFORM_PROFILE_UPDATE_FAILED",
    });
  }
}

async function changeMyPlatformPassword(req, res) {
  const currentUserId = getPlatformUserId(req);
  const currentPassword = String(req.body?.currentPassword || "");
  const nextPassword = String(req.body?.nextPassword || "");

  if (!currentUserId) {
    return res.status(401).json({
      message: "Unauthorized",
      code: "PLATFORM_AUTH_REQUIRED",
    });
  }

  if (!currentPassword || !nextPassword) {
    return res.status(400).json({
      message: "currentPassword and nextPassword are required",
      code: "PASSWORD_FIELDS_REQUIRED",
    });
  }

  if (nextPassword.length < 8) {
    return res.status(400).json({
      message: "New password must be at least 8 characters",
      code: "PASSWORD_TOO_SHORT",
    });
  }

  try {
    const user = await prisma.platformUser.findUnique({
      where: { id: currentUserId },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "PLATFORM_AUTH_REQUIRED",
      });
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({
        message: "Current password is incorrect",
        code: "CURRENT_PASSWORD_INVALID",
      });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 12);

    const updated = await prisma.platformUser.update({
      where: { id: currentUserId },
      data: { passwordHash },
      select: platformUserSelect(),
    });

    return res.json({
      message: "Platform password changed",
      platformUser: safePlatformUser(updated),
    });
  } catch (err) {
    console.error("changeMyPlatformPassword error:", err);
    return res.status(500).json({
      message: "Failed to change platform password",
      code: "PLATFORM_PASSWORD_CHANGE_FAILED",
    });
  }
}

module.exports = {
  listPlatformUsers,
  getPlatformUserById,
  createPlatformUser,
  updatePlatformUserRole,
  updatePlatformUserStatus,
  resetPlatformUserPassword,
  updateMyPlatformProfile,
  changeMyPlatformPassword,
};