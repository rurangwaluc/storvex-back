const express = require("express");
const router = express.Router();

const controller = require("./platform.auth.controller");

router.post("/login", controller.platformLogin);

module.exports = router;
