const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.accounts.controller");

/**
 * WhatsApp account management
 * Locked to owner/manager because this controls live channel credentials.
 */
router.use(authenticate, requireTenant, requireRole("OWNER", "MANAGER"));

router.get("/accounts", controller.listAccounts);
router.post("/accounts", controller.createAccount);
router.patch("/accounts/:id", controller.updateAccount);

module.exports = router;