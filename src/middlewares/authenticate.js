const jwt = require("jsonwebtoken");

module.exports = function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach ALL required claims for downstream guards
    req.user = {
      id: decoded.userId,
      userId: decoded.userId,
      tenantId: decoded.tenantId || null,
      role: decoded.role,
      platform: decoded.platform === true, // 🔥 FIX
    };

    next();
  } catch (err) {
    console.error("JWT ERROR:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
