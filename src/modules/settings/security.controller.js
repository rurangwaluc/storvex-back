"use strict";

const bcrypt = require("bcryptjs");
const prisma = require("../../config/database");

const ACTIVE_SESSION_LIMIT = 12;
const LOGIN_EVENT_LIMIT = 20;

function cleanString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function readIp(req) {
  const forwarded = cleanString(req.headers["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0].trim() || null;

  return cleanString(req.ip) || cleanString(req.socket?.remoteAddress);
}

function readUserAgent(req) {
  return cleanString(req.headers["user-agent"]);
}

function parseUserAgent(ua) {
  const text = String(ua || "");
  const value = lower(text);

  if (!text) return "Unknown device";

  const isExpo = value.includes("expo");
  const isChrome = value.includes("chrome") || value.includes("crios");
  const isSafari = value.includes("safari") && !isChrome;
  const isFirefox = value.includes("firefox");
  const isEdge = value.includes("edg/");
  const isSamsung = value.includes("samsungbrowser");

  let device = "Unknown device";

  if (value.includes("cros")) device = "Chromebook";
  else if (value.includes("iphone")) device = "iPhone";
  else if (value.includes("ipad")) device = "iPad";
  else if (value.includes("android")) device = "Android device";
  else if (value.includes("windows")) device = "Windows device";
  else if (value.includes("macintosh") || value.includes("mac os")) device = "Mac device";
  else if (value.includes("linux")) device = "Linux device";

  let app = null;

  if (isExpo) app = "Storvex mobile";
  else if (isSamsung) app = "Samsung Internet";
  else if (isEdge) app = "Microsoft Edge";
  else if (isChrome) app = "Chrome";
  else if (isFirefox) app = "Firefox";
  else if (isSafari) app = "Safari";

  return app ? `${device} · ${app}` : device;
}

function sessionStatus(session, now = new Date()) {
  if (session?.isRevoked) return "SIGNED_OUT";

  if (session?.expiresAt) {
    const expiresAt = new Date(session.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt < now) return "EXPIRED";
  }

  return "ACTIVE";
}

function publicSession(session, currentSessionId, now = new Date()) {
  const isCurrent = Boolean(currentSessionId && session.id === currentSessionId);
  const status = sessionStatus(session, now);

  return {
    id: session.id,
    tokenId: session.tokenId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    isRevoked: Boolean(session.isRevoked),
    revokedAt: session.revokedAt || null,
    ipAddress: session.ipAddress || null,
    userAgent: session.userAgent || null,
    deviceLabel: isCurrent ? "Current device" : parseUserAgent(session.userAgent),
    isCurrent,
    status,
  };
}

function publicLoginEvent(event) {
  return {
    id: event.id,
    status: event.status || "SUCCESS",
    role: event.role || null,
    email: event.email || null,
    reason: event.reason || null,
    createdAt: event.createdAt,
    ipAddress: event.ipAddress || null,
    userAgent: event.userAgent || null,
    deviceLabel: event.deviceLabel || parseUserAgent(event.userAgent),
    method: event.method || null,
  };
}

function passwordProblems(value) {
  const password = String(value || "");
  const problems = [];

  if (password.length < 8) {
    problems.push("Use at least 8 characters.");
  }

  if (!/[a-z]/.test(password)) {
    problems.push("Add a lowercase letter.");
  }

  if (!/[A-Z]/.test(password)) {
    problems.push("Add an uppercase letter.");
  }

  if (!/[0-9]/.test(password)) {
    problems.push("Add a number.");
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    problems.push("Add a symbol.");
  }

  return problems;
}

function buildRiskSummary({ activeSessions, failedAttempts, lastPasswordChangeAt }) {
  if (failedAttempts >= 5) {
    return {
      level: "ACTION_NEEDED",
      label: "Action needed",
      message: "Several failed sign-in attempts were recorded. Review account access.",
    };
  }

  if (!lastPasswordChangeAt) {
    return {
      level: "REVIEW",
      label: "Review needed",
      message: "No password change is recorded yet. Set a strong password for owner access.",
    };
  }

  if (activeSessions > 3) {
    return {
      level: "REVIEW",
      label: "Review needed",
      message: "Several devices are signed in. Remove devices that should not have access.",
    };
  }

  return {
    level: "SAFE",
    label: "Looks safe",
    message: "Account access, password history, and active devices look normal.",
  };
}

async function getCurrentSession({ tenantId, userId, currentSessionId }) {
  if (!currentSessionId) return null;

  return prisma.userSession.findFirst({
    where: {
      id: currentSessionId,
      tenantId,
      userId,
    },
    select: {
      id: true,
      tokenId: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
      isRevoked: true,
      revokedAt: true,
    },
  });
}

async function getSecurityOverview(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;
    const now = new Date();

    const recentWindowStart = new Date(now);
    recentWindowStart.setDate(recentWindowStart.getDate() - 30);

    const [
      user,
      currentSession,
      activeSessions,
      signedOutSessions,
      recentLogins,
      failedAttempts,
      lastPasswordChange,
    ] = await Promise.all([
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

      getCurrentSession({ tenantId, userId, currentSessionId }),

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

      prisma.loginEvent.count({
        where: {
          tenantId,
          userId,
          status: "SUCCESS",
          createdAt: { gte: recentWindowStart },
        },
      }),

      prisma.loginEvent.count({
        where: {
          tenantId,
          userId,
          status: { in: ["FAILED", "BLOCKED"] },
          createdAt: { gte: recentWindowStart },
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

    const lastPasswordChangeAt = lastPasswordChange?.createdAt || null;

    return res.json({
      overview: {
        currentSessionId,
        role: user.role,
        email: user.email,
        isActive: user.isActive !== false,
        accountCreatedAt: user.createdAt,
        accountUpdatedAt: null,
        lastSeenAt: currentSession?.lastSeenAt || null,
        lastLoginAt: currentSession?.createdAt || null,
        currentDeviceLabel: currentSession
          ? "Current device"
          : parseUserAgent(readUserAgent(req)),
        currentIpAddress: currentSession?.ipAddress || readIp(req) || null,
        risk: buildRiskSummary({
          activeSessions,
          failedAttempts,
          lastPasswordChangeAt,
        }),
        summary: {
          activeSessions,
          revokedSessions: signedOutSessions,
          recentLogins,
          failedAttempts,
          lastPasswordChangeAt,
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
    const currentSessionId = req.user.sessionId || null;
    const now = new Date();

    const sessions = await prisma.userSession.findMany({
      where: { tenantId, userId },
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: ACTIVE_SESSION_LIMIT,
      select: {
        id: true,
        tokenId: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        isRevoked: true,
        revokedAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    const sorted = sessions
      .map((session) => publicSession(session, currentSessionId, now))
      .sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;

        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;

        const aTime = new Date(a.lastSeenAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.lastSeenAt || b.createdAt || 0).getTime();

        return bTime - aTime;
      });

    return res.json({ sessions: sorted });
  } catch (err) {
    console.error("getSecuritySessions error:", err);
    return res.status(500).json({ message: "Failed to fetch security sessions" });
  }
}

async function getSecurityLoginEvents(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const events = await prisma.loginEvent.findMany({
      where: {
        tenantId,
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { createdAt: "desc" },
      take: LOGIN_EVENT_LIMIT,
      select: {
        id: true,
        status: true,
        role: true,
        email: true,
        method: true,
        ipAddress: true,
        userAgent: true,
        deviceLabel: true,
        reason: true,
        createdAt: true,
      },
    });

    return res.json({
      events: events.map(publicLoginEvent),
    });
  } catch (err) {
    console.error("getSecurityLoginEvents error:", err);
    return res.status(500).json({ message: "Failed to fetch login events" });
  }
}

async function revokeSecuritySession(req, res) {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;
    const currentSessionId = req.user.sessionId || null;
    const sessionId = cleanString(req.params.sessionId);

    if (!sessionId) {
      return res.status(400).json({ message: "Session is required" });
    }

    if (currentSessionId && sessionId === currentSessionId) {
      return res.status(400).json({
        message: "Use Sign out to remove the current device.",
      });
    }

    const session = await prisma.userSession.findFirst({
      where: {
        id: sessionId,
        tenantId,
        userId,
      },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
      },
    });

    if (!session) {
      return res.status(404).json({ message: "Device session not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userSession.update({
        where: { id: session.id },
        data: {
          isRevoked: true,
          revokedAt: new Date(),
        },
      });

      await tx.loginEvent.create({
        data: {
          tenantId,
          userId,
          email: req.user.email || null,
          role: req.user.role || null,
          status: "BLOCKED",
          method: "SESSION_REVOKE",
          ipAddress: readIp(req),
          userAgent: readUserAgent(req),
          deviceLabel: parseUserAgent(session.userAgent),
          reason: "A signed-in device was removed from Security settings.",
        },
      });
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

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.userSession.updateMany({
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

      await tx.loginEvent.create({
        data: {
          tenantId,
          userId,
          email: req.user.email || null,
          role: req.user.role || null,
          status: "BLOCKED",
          method: "SESSION_REVOKE_OTHERS",
          ipAddress: readIp(req),
          userAgent: readUserAgent(req),
          deviceLabel: parseUserAgent(readUserAgent(req)),
          reason: "Other signed-in devices were removed from Security settings.",
        },
      });

      return updateResult;
    });

    return res.json({
      ok: true,
      message: "Other devices signed out",
      count: result.count || 0,
    });
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
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    const problems = passwordProblems(newPassword);
    if (problems.length) {
      return res.status(400).json({
        message: `Password is not strong enough. ${problems.join(" ")}`,
      });
    }

    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({
        message: "New password must be different from the current password.",
      });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        password: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const valid = await bcrypt.compare(String(currentPassword), user.password);
    if (!valid) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashed = await bcrypt.hash(String(newPassword), 12);

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
          ipAddress: readIp(req),
          userAgent: readUserAgent(req),
        },
      });

      await tx.loginEvent.create({
        data: {
          tenantId,
          userId,
          email: user.email || req.user.email || null,
          role: user.role || req.user.role || null,
          status: "SUCCESS",
          method: "PASSWORD_CHANGE",
          ipAddress: readIp(req),
          userAgent: readUserAgent(req),
          deviceLabel: parseUserAgent(readUserAgent(req)),
          reason: Boolean(revokeOtherSessions)
            ? "Password changed and other devices were signed out."
            : "Password changed.",
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