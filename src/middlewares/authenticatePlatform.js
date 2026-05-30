const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

module.exports = async function authenticatePlatform(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({
      message: "Missing platform token",
      code: "PLATFORM_TOKEN_MISSING",
    });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired platform token",
      code: "PLATFORM_TOKEN_INVALID",
    });
  }

  const userId = decoded?.userId || decoded?.id || null;

  if (!decoded?.platform || !userId) {
    return res.status(401).json({
      message: "Invalid platform token claims",
      code: "PLATFORM_TOKEN_CLAIMS_INVALID",
    });
  }

  try {
    const platformUser = await prisma.platformUser.findUnique({
      where: { id: userId },
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

    if (!platformUser) {
      return res.status(401).json({
        message: "Platform user not found",
        code: "PLATFORM_USER_NOT_FOUND",
      });
    }

    if (platformUser.isActive === false) {
      return res.status(403).json({
        message: "Platform user is disabled",
        code: "PLATFORM_USER_DISABLED",
      });
    }

    req.platformUser = platformUser;

    req.user = {
      id: platformUser.id,
      userId: platformUser.id,
      email: platformUser.email,
      name: platformUser.name,
      role: platformUser.role,
      normalizedRole: normalizeRole(platformUser.role),
      platform: true,
    };

    return next();
  } catch (error) {
    console.error("Platform authentication failed:", error);

    return res.status(500).json({
      message: "Platform authentication failed",
      code: "PLATFORM_AUTH_FAILED",
    });
  }
};