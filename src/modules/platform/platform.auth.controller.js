// backend/src/modules/platform/platform.auth.controller.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/database");

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanString(value) {
  const s = String(value || "").trim();
  return s || "";
}

function getJwtSecret() {
  return (
    process.env.PLATFORM_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.ACCESS_TOKEN_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    null
  );
}

function publicPlatformUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function signPlatformToken(user) {
  const secret = getJwtSecret();

  if (!secret) {
    const err = new Error("PLATFORM_JWT_SECRET_MISSING");
    err.code = "PLATFORM_JWT_SECRET_MISSING";
    throw err;
  }

  return jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      scope: "PLATFORM",
      tokenType: "PLATFORM_ACCESS",
    },
    secret,
    {
      expiresIn: process.env.PLATFORM_JWT_EXPIRES_IN || "12h",
    }
  );
}

async function platformLogin(req, res) {
  try {
    const email = cleanEmail(req.body?.email);
    const password = cleanString(req.body?.password);

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
        code: "PLATFORM_LOGIN_REQUIRED",
      });
    }

    const user = await prisma.platformUser.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
      },
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        message: "Invalid platform login details",
        code: "PLATFORM_INVALID_CREDENTIALS",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        message: "This platform account is not active",
        code: "PLATFORM_ACCOUNT_DISABLED",
      });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    if (!passwordOk) {
      return res.status(401).json({
        message: "Invalid platform login details",
        code: "PLATFORM_INVALID_CREDENTIALS",
      });
    }

    const updatedUser = await prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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

    const token = signPlatformToken(updatedUser);

    return res.json({
      message: "Platform login successful",
      token,
      platformUser: publicPlatformUser(updatedUser),
    });
  } catch (error) {
    console.error("Platform login failed:", error);

    if (error?.code === "PLATFORM_JWT_SECRET_MISSING") {
      return res.status(500).json({
        message: "Platform login is not configured",
        code: "PLATFORM_JWT_SECRET_MISSING",
      });
    }

    return res.status(500).json({
      message: "Platform login failed",
      code: "PLATFORM_LOGIN_FAILED",
    });
  }
}

async function platformMe(req, res) {
  try {
    const userId = req.platformUser?.id || req.user?.id || req.user?.userId || null;

    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    const user = await prisma.platformUser.findUnique({
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

    if (!user || user.isActive === false) {
      return res.status(401).json({
        message: "Unauthorized",
        code: "PLATFORM_UNAUTHORIZED",
      });
    }

    return res.json({
      platformUser: publicPlatformUser(user),
    });
  } catch (error) {
    console.error("Failed to load platform user:", error);

    return res.status(500).json({
      message: "Failed to load platform user",
      code: "PLATFORM_ME_FAILED",
    });
  }
}

module.exports = {
  platformLogin,
  platformMe,
};