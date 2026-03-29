// src/middlewares/authenticateHeaderOrQueryToken.js
const jwt = require("jsonwebtoken");
const authenticate = require("./authenticate");

function getBearer(req) {
  const h = req.headers?.authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function getJwtSecretOrThrow() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    const err = new Error("Missing JWT_SECRET");
    err.status = 500;
    throw err;
  }
  return s;
}

module.exports = function authenticateHeaderOrQueryToken(req, res, next) {
  // 1) Authorization header → normal auth
  const bearer = getBearer(req);
  if (bearer) return authenticate(req, res, next);

  // 2) ?token= fallback
  const token = req.query?.token ? String(req.query.token).trim() : null;
  if (!token) return res.status(401).send("Unauthorized");

  try {
    const payload = jwt.verify(token, getJwtSecretOrThrow());

    // Match shape of authenticate.js to avoid mismatches
    req.user = {
      id: payload.userId || null,
      userId: payload.userId || null,
      tenantId: payload.tenantId || null,
      role: payload.role || null,
      platform: payload.platform === true,
    };

    if (!req.user.userId || !req.user.role || !req.user.tenantId) {
      return res.status(401).send("Unauthorized");
    }

    return next();
  } catch (e) {
    // If JWT_SECRET missing, return 500 (real error), not 401
    if (e?.status === 500) {
      return res.status(500).send("Server misconfigured");
    }
    return res.status(401).send("Unauthorized");
  }
};