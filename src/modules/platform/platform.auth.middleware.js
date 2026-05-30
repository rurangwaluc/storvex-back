const jwt = require("jsonwebtoken");
const prisma = require("../../config/database");

function getPlatformJwtSecret() {
  return (
    process.env.PLATFORM_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    null
  );
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const value = String(header || "").trim();

  if (!value) return null;

  if (value.toLowerCase().startsWith("bearer ")) {
    return value.slice(7).trim();
  }

  return null;
}

async function requirePlatformAuth(req, res, next) {
  try {
    const secret = getPlatformJwtSecret();

    if (!secret) {
      return res.status(500).json({
        message: "Platform JWT secret is not configured",
        code: "PLATFORM_JWT_SECRET_MISSING",
      });
    }

    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({
        message: "Platform authentication token is required",
        code: "PLATFORM_TOKEN_REQUIRED",
      });
    }

    let decoded;

    try {
      decoded = jwt.verify(token, secret);
    } catch {
      return res.status(401).json({
        message: "Invalid or expired platform token",
        code: "PLATFORM_TOKEN_INVALID",
      });
    }

    if (
      decoded?.scope !== "PLATFORM" ||
      decoded?.tokenType !== "PLATFORM_ACCESS"
    ) {
      return res.status(403).json({
        message: "This token is not allowed to access platform routes",
        code: "PLATFORM_TOKEN_SCOPE_INVALID",
      });
    }

    const platformUserId = decoded.userId || decoded.sub;

    if (!platformUserId) {
      return res.status(401).json({
        message: "Invalid platform token payload",
        code: "PLATFORM_TOKEN_PAYLOAD_INVALID",
      });
    }

    const platformUser = await prisma.platformUser.findFirst({
      where: {
        id: platformUserId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    });

    if (!platformUser) {
      return res.status(401).json({
        message: "Platform user not found or inactive",
        code: "PLATFORM_USER_NOT_ALLOWED",
      });
    }

    req.platformUser = platformUser;

    return next();
  } catch (err) {
    console.error("requirePlatformAuth error:", err);

    return res.status(500).json({
      message: "Platform authentication failed",
      code: "PLATFORM_AUTH_FAILED",
    });
  }
}

function requirePlatformRole(...roles) {
  const allowedRoles = roles.map((role) => String(role).toUpperCase());

  return (req, res, next) => {
    const role = String(req.platformUser?.role || "").toUpperCase();

    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "Platform access denied",
        code: "PLATFORM_ROLE_DENIED",
      });
    }

    return next();
  };
}

module.exports = {
  requirePlatformAuth,
  authenticatePlatform: requirePlatformAuth,
  requirePlatformRole,
};
