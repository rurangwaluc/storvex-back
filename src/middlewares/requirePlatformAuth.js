// backend/src/middlewares/requirePlatformAuth.js

const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

function getAuthToken(req) {
  const header = req.headers.authorization || "";

  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return null;
}

function getJwtSecret() {
  return (
    process.env.PLATFORM_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    null
  );
}

function forbidden(res, message = "Forbidden", code = "PLATFORM_FORBIDDEN") {
  return res.status(403).json({ message, code });
}

function unauthorized(res, message = "Unauthorized", code = "PLATFORM_UNAUTHORIZED") {
  return res.status(401).json({ message, code });
}

async function requirePlatformAuth(req, res, next) {
  try {
    const secret = getJwtSecret();

    if (!secret) {
      return res.status(500).json({
        message: "Platform authentication is not configured",
        code: "PLATFORM_JWT_SECRET_MISSING",
      });
    }

    const token = getAuthToken(req);

    if (!token) {
      return unauthorized(res);
    }

    let decoded;

    try {
      decoded = jwt.verify(token, secret);
    } catch {
      return unauthorized(res, "Invalid or expired platform session", "PLATFORM_TOKEN_INVALID");
    }

    if (
      decoded?.scope !== "PLATFORM" ||
      decoded?.tokenType !== "PLATFORM_ACCESS" ||
      !decoded?.userId
    ) {
      return forbidden(res, "This token cannot access platform routes", "INVALID_PLATFORM_TOKEN");
    }

    const platformUser = await prisma.platformUser.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    });

    if (!platformUser || platformUser.isActive === false) {
      return unauthorized(res, "Platform account is inactive or unavailable", "PLATFORM_ACCOUNT_INACTIVE");
    }

    req.platformUser = platformUser;

    return next();
  } catch (error) {
    console.error("Platform auth middleware failed:", error);

    return res.status(500).json({
      message: "Platform authentication failed",
      code: "PLATFORM_AUTH_FAILED",
    });
  }
}

function requirePlatformRole(...allowedRoles) {
  return function platformRoleGuard(req, res, next) {
    const role = req.platformUser?.role;

    if (!role) {
      return unauthorized(res);
    }

    if (!allowedRoles.includes(role)) {
      return forbidden(res, "Your platform role cannot access this action", "PLATFORM_ROLE_DENIED");
    }

    return next();
  };
}

module.exports = {
  requirePlatformAuth,
  requirePlatformRole,
};