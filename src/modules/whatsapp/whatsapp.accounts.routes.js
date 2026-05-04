const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.accounts.controller");
const { WHATSAPP_OWNER_ROLES } = require("./whatsapp.roles");

/**
 * WhatsApp account settings
 *
 * Storvex strategy:
 * - One WhatsApp number per store/tenant.
 * - Customers see one business WhatsApp number.
 * - Internal branch truth is handled later in conversations, sale drafts,
 *   inventory, drawer, receipts, and audit records.
 */
router.use(
  authenticate,
  requireTenant,
  requireRole(...WHATSAPP_OWNER_ROLES)
);

/**
 * GET /api/whatsapp/accounts
 * List the store WhatsApp account.
 */
router.get("/accounts", controller.listAccounts);

/**
 * POST /api/whatsapp/accounts
 * Create the store WhatsApp account.
 *
 * The service enforces one account per tenant.
 */
router.post("/accounts", controller.createAccount);

/**
 * GET /api/whatsapp/accounts/:id
 * Fetch one WhatsApp account.
 */
router.get("/accounts/:id", controller.getAccount);

/**
 * PATCH /api/whatsapp/accounts/:id
 * Update WhatsApp account credentials/settings.
 */
router.patch("/accounts/:id", controller.updateAccount);

/**
 * PATCH /api/whatsapp/accounts/:id/active
 * Activate or deactivate WhatsApp account.
 *
 * Body:
 * {
 *   "isActive": true
 * }
 */
router.patch("/accounts/:id/active", controller.setAccountActive);

module.exports = router;