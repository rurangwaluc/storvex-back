const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const usersController = require("./users.controller");

// OWNER creates cashier or technician
router.post(
  "/",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  usersController.createStaff
);

module.exports = router;
