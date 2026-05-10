const express = require("express");

const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.inbox.controller");
const { WHATSAPP_WORKSPACE_ROLES } = require("./whatsapp.roles");

/**
 * WhatsApp inbox workspace
 *
 * Customer experience:
 * - one store WhatsApp number
 *
 * Internal Storvex rule:
 * - conversations can be tenant-level
 * - sale drafts/finalized WhatsApp sales must resolve to a branch
 * - stock, drawer, payment, receipt, and audit trail must respect branch truth
 * - unread/read state is tracked per staff/owner user
 */
router.use(
  authenticate,
  requireTenant,
  requireRole(...WHATSAPP_WORKSPACE_ROLES)
);

/**
 * Staff assignment
 *
 * GET /api/whatsapp/inbox/assignable-staff
 */
router.get("/inbox/assignable-staff", controller.listAssignableStaff);

/**
 * Conversations
 *
 * GET   /api/whatsapp/inbox/conversations
 * GET   /api/whatsapp/inbox/conversations/:id/messages
 * PATCH /api/whatsapp/inbox/conversations/:id/read
 * POST  /api/whatsapp/inbox/conversations/:id/reply
 * PATCH /api/whatsapp/inbox/conversations/:id/status
 * PATCH /api/whatsapp/inbox/conversations/:id/assign
 * PATCH /api/whatsapp/inbox/conversations/:id/unassign
 */
router.get("/inbox/conversations", controller.listConversations);

router.get("/inbox/conversations/:id/messages", controller.listMessages);

router.patch("/inbox/conversations/:id/read", controller.markConversationRead);

router.post("/inbox/conversations/:id/reply", controller.reply);

router.patch("/inbox/conversations/:id/status", controller.updateStatus);

router.patch("/inbox/conversations/:id/assign", controller.assignConversation);

router.patch("/inbox/conversations/:id/unassign", controller.unassignConversation);

/**
 * Sale drafts from WhatsApp
 *
 * GET    /api/whatsapp/inbox/sale-drafts
 * GET    /api/whatsapp/inbox/sale-drafts/:saleId
 * POST   /api/whatsapp/inbox/conversations/:id/sale-draft
 * POST   /api/whatsapp/inbox/conversations/:id/create-sale-draft
 * PATCH  /api/whatsapp/inbox/sale-drafts/:saleId
 * DELETE /api/whatsapp/inbox/sale-drafts/:saleId
 * POST   /api/whatsapp/inbox/sale-drafts/:saleId/finalize
 */
router.get("/inbox/sale-drafts", controller.listSaleDrafts);

router.get("/inbox/sale-drafts/:saleId", controller.getSaleDraft);

/**
 * Preferred clean endpoint.
 */
router.post("/inbox/conversations/:id/sale-draft", controller.createSaleDraft);

/**
 * Backward-compatible endpoint.
 * Keep this so any existing frontend/Postman tests do not break.
 */
router.post(
  "/inbox/conversations/:id/create-sale-draft",
  controller.createSaleDraft
);

router.patch("/inbox/sale-drafts/:saleId", controller.updateSaleDraft);

router.delete("/inbox/sale-drafts/:saleId", controller.deleteSaleDraft);

router.post("/inbox/sale-drafts/:saleId/finalize", controller.finalizeSaleDraft);

module.exports = router;