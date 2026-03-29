const jwt = require("jsonwebtoken");

function assertJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    const err = new Error("Missing JWT_SECRET");
    err.status = 500;
    throw err;
  }
  return s;
}

function parseBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const s = String(h);
  if (!s.toLowerCase().startsWith("bearer ")) return null;
  return s.slice(7).trim();
}

module.exports = function authenticateHeaderOrQueryToken(req, res, next) {
  try {
    const JWT_SECRET = assertJwtSecret();

    const token =
      parseBearerToken(req) ||
      (req.query?.token ? String(req.query.token).trim() : null);

    if (!token) return res.status(401).send("Unauthorized");

    const payload = jwt.verify(token, JWT_SECRET);

    req.user = {
      userId: payload.userId || null,
      role: payload.role || null,
      tenantId: payload.tenantId || null,
    };

    if (!req.user.userId || !req.user.role || !req.user.tenantId) {
      return res.status(401).send("Unauthorized");
    }

    return next();
  } catch (e) {
    return res.status(401).send("Unauthorized");
  }
};