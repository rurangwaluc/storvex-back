const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

module.exports = async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error("JWT VERIFY ERROR:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  const userId = decoded.userId || decoded.id || null;
  const tenantId = decoded.tenantId || null;
  const tokenId = decoded.tokenId || null;

  if (!userId || !tenantId) {
    return res.status(401).json({ message: "Invalid token claims" });
  }

  try {
    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.isActive === false) {
      return res.status(403).json({ message: "Account is deactivated" });
    }

    let sessionId = null;

    if (tokenId) {
      const session = await prisma.userSession.findFirst({
        where: {
          tenantId,
          userId,
          tokenId,
        },
        select: {
          id: true,
          isRevoked: true,
          expiresAt: true,
        },
      });

      if (!session) {
        return res.status(401).json({ message: "Session not found" });
      }

      if (session.isRevoked) {
        return res.status(401).json({ message: "Session revoked" });
      }

      if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
        return res.status(401).json({ message: "Session expired" });
      }

      sessionId = session.id;

      await prisma.userSession.update({
        where: { id: session.id },
        data: {
          lastSeenAt: new Date(),
        },
      });
    }

    req.user = {
      id: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      tokenId: tokenId || null,
      sessionId,
      platform: decoded.platform === true,
    };

    return next();
  } catch (err) {
    console.error("AUTH DATABASE ERROR:", err);

    const msg = String(err?.message || "");
    if (msg.includes("Can't reach database server") || err?.code === "P1001") {
      return res.status(503).json({
        message: "Authentication service temporarily unavailable",
        code: "AUTH_DB_UNAVAILABLE",
      });
    }

    return res.status(500).json({ message: "Authentication failed" });
  }
};