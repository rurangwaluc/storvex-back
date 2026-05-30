const express = require("express");

const router = express.Router();

/**
 * Platform root router.
 *
 * Keep this file intentionally small.
 *
 * Dedicated platform modules are mounted in app.js:
 * - /api/platform/auth      -> platform.auth.routes.js
 * - /api/platform/users     -> platform.users.routes.js
 * - /api/platform/tenants   -> platform.tenants.routes.js
 * - /api/platform/audit     -> platform.audit.routes.js
 * - /api/platform/billing   -> platform.billing.routes.js
 * - /api/platform/support   -> platform.support.routes.js
 *
 * Do NOT define /auth, /users, /tenants, /audit, /billing, or /support here.
 * If this file defines those paths, it can shadow the dedicated route files.
 */

router.get("/", (req, res) => {
  return res.json({
    message: "Storvex platform API",
    modules: {
      auth: "/api/platform/auth",
      users: "/api/platform/users",
      tenants: "/api/platform/tenants",
      audit: "/api/platform/audit",
      billing: "/api/platform/billing",
      support: "/api/platform/support",
    },
  });
});

module.exports = router;