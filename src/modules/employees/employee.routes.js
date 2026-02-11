const express = require("express");
const router = express.Router();

const controller = require("./employee.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const requireActiveSubscription = require("../../middlewares/requireActiveSubscription");

// OWNER ONLY
router.use(authenticate, requireTenant, requireRole("OWNER"));
router.use(authenticate, requireTenant, requireActiveSubscription, requireRole("OWNER"));

// Employee routes
router.post("/", controller.createEmployee);
router.get("/", controller.listEmployees);  // This route will return both employees and subscription info
router.put("/:id", controller.updateEmployee);
router.delete("/:id", controller.deleteEmployee);

module.exports = router;
