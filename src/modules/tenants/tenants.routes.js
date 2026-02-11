const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

router.get(
  "/test-owner",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  (req, res) => {
    res.json({
      message: "OWNER access granted",
      user: req.user,
    });
  }
);

router.get(
  "/test-cashier",
  authenticate,
  requireTenant,
  requireRole("CASHIER"),
  (req, res) => {
    res.json({
      message: "CASHIER access granted",
      user: req.user,
    });
  }
);

module.exports = router;
