// src/middlewares/authenticate.js
const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

module.exports = async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userId = decoded.userId || decoded.id || null;
    const tenantId = decoded.tenantId || null;

    if (!userId || !tenantId) {
      return res.status(401).json({ message: "Invalid token claims" });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isActive === false) {
      return res.status(403).json({ message: "Account is deactivated" });
    }

    req.user = {
      id: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      platform: decoded.platform === true,
    };

    return next();
  } catch (err) {
    console.error("JWT ERROR:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};