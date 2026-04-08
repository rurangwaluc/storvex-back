const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");

function parseUserAgent(ua) {
  const text = String(ua || "");

  if (!text) return "Unknown device";
  if (text.includes("Windows")) return "Windows device";
  if (text.includes("Macintosh")) return "Mac device";
  if (text.includes("Android")) return "Android device";
  if (text.includes("iPhone")) return "iPhone";
  if (text.includes("iPad")) return "iPad";
  if (text.includes("Linux")) return "Linux device";

  return "Unknown device";
}

async function getSecurityOverview(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;
    const now = new Date();

    const [user, activeSessions, revokedSessions, recentSessions, lastPasswordChange] =
      await Promise.all([
        prisma.user.findFirst({
          where: { id: userId, tenantId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        }),

        prisma.userSession.count({
          where: {
            tenantId,
            userId,
            isRevoked: false,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        }),

        prisma.userSession.count({
          where: {
            tenantId,
            userId,
            isRevoked: true,
          },
        }),

        prisma.userSession.findMany({
          where: { tenantId, userId },
          orderBy: [{ createdAt: "desc" }],
          take: 20,
          select: {
            id: true,
            createdAt: true,
            lastSeenAt: true,
            expiresAt: true,
            ipAddress: true,
            userAgent: true,
            isRevoked: true,
          },
        }),

        prisma.passwordChangeEvent.findFirst({
          where: { tenantId, userId },
          orderBy: { createdAt: "desc" },
          select: {
            createdAt: true,
          },
        }),
      ]);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const latestSession =
      recentSessions.find((s) => s.lastSeenAt) || recentSessions[0] || null;

    const recentLogins = recentSessions.length;
    const failedAttempts = 0;

    return res.json({
      overview: {
        currentSessionId,
        role: user.role,
        email: user.email,
        isActive: user.isActive !== false,
        accountCreatedAt: user.createdAt,
        accountUpdatedAt: null,
        lastSeenAt: latestSession?.lastSeenAt || null,
        lastLoginAt: latestSession?.createdAt || null,
        currentDeviceLabel: parseUserAgent(latestSession?.userAgent),
        summary: {
          activeSessions,
          revokedSessions,
          recentLogins,
          failedAttempts,
          lastPasswordChangeAt: lastPasswordChange?.createdAt || null,
        },
      },
    });
  } catch (err) {
    console.error("getSecurityOverview error:", err);
    return res.status(500).json({ message: "Failed to fetch security overview" });
  }
}

async function getSecuritySessions(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const sessions = await prisma.userSession.findMany({
      where: { tenantId, userId },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        tokenId: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        isRevoked: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    return res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        tokenId: s.tokenId,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        isRevoked: s.isRevoked,
        ipAddress: s.ipAddress || null,
        userAgent: s.userAgent || "Unknown device",
        deviceLabel: parseUserAgent(s.userAgent),
      })),
    });
  } catch (err) {
    console.error("getSecuritySessions error:", err);
    return res.status(500).json({ message: "Failed to fetch security sessions" });
  }
}

async function getSecurityLoginEvents(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        email: true,
        role: true,
      },
    });

    const sessions = await prisma.userSession.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
        isRevoked: true,
      },
    });

    const events = sessions.map((s) => ({
      id: s.id,
      status: s.isRevoked ? "BLOCKED" : "SUCCESS",
      role: user?.role || null,
      email: user?.email || null,
      reason: s.isRevoked ? "This device was signed out." : null,
      createdAt: s.createdAt,
      ipAddress: s.ipAddress || null,
      userAgent: s.userAgent || "Unknown device",
      deviceLabel: parseUserAgent(s.userAgent),
    }));

    return res.json({ events });
  } catch (err) {
    console.error("getSecurityLoginEvents error:", err);
    return res.status(500).json({ message: "Failed to fetch login events" });
  }
}

async function revokeSecuritySession(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const sessionId = String(req.params.sessionId || "").trim();

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const session = await prisma.userSession.findFirst({
      where: {
        id: sessionId,
        tenantId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    await prisma.userSession.update({
      where: { id: session.id },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });

    return res.json({ ok: true, message: "Device signed out" });
  } catch (err) {
    console.error("revokeSecuritySession error:", err);
    return res.status(500).json({ message: "Failed to sign out device" });
  }
}

async function revokeOtherSecuritySessions(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;

    await prisma.userSession.updateMany({
      where: {
        tenantId,
        userId,
        isRevoked: false,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: {
        isRevoked: true,
        revokedAt: new Date(),
      },
    });

    return res.json({ ok: true, message: "Other devices signed out" });
  } catch (err) {
    console.error("revokeOtherSecuritySessions error:", err);
    return res.status(500).json({ message: "Failed to sign out other devices" });
  }
}

async function changeMyPassword(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;

    const { currentPassword, newPassword, revokeOtherSessions } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        password: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const valid = await bcrypt.compare(String(currentPassword), user.password);
    if (!valid) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashed = await bcrypt.hash(String(newPassword), 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          password: hashed,
        },
      });

      await tx.passwordChangeEvent.create({
        data: {
          tenantId,
          userId,
          changedById: userId,
          ipAddress: req.ip || null,
          userAgent: req.headers["user-agent"] ? String(req.headers["user-agent"]) : null,
        },
      });

      if (Boolean(revokeOtherSessions)) {
        await tx.userSession.updateMany({
          where: {
            tenantId,
            userId,
            isRevoked: false,
            ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
          },
          data: {
            isRevoked: true,
            revokedAt: new Date(),
          },
        });
      }
    });

    return res.json({ ok: true, message: "Password updated" });
  } catch (err) {
    console.error("changeMyPassword error:", err);
    return res.status(500).json({ message: "Failed to update password" });
  }
}

module.exports = {
  getSecurityOverview,
  getSecuritySessions,
  getSecurityLoginEvents,
  revokeSecuritySession,
  revokeOtherSecuritySessions,
  changeMyPassword,
};