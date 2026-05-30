// backend/src/modules/platform/platform.auth.routes.js

const express = require("express");

const controller = require("./platform.auth.controller");
const { requirePlatformAuth } = require("./platform.auth.middleware");

const router = express.Router();

router.post("/login", controller.platformLogin);

router.get("/me", requirePlatformAuth, controller.platformMe);

module.exports = router;
