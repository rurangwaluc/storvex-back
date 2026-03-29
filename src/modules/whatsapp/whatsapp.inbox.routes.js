const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.inbox.controller");

router.use(authenticate, requireTenant, requireRole("OWNER", "CASHIER"));

router.get("/inbox/conversations", controller.listConversations);
router.get("/inbox/conversations/:id/messages", controller.listMessages);
router.post("/inbox/conversations/:id/reply", controller.reply);
router.patch("/inbox/conversations/:id/status", controller.updateStatus);

router.get("/inbox/sale-drafts", controller.listSaleDrafts);
router.get("/inbox/sale-drafts/:saleId", controller.getSaleDraft);
router.post("/inbox/conversations/:id/create-sale-draft", controller.createSaleDraft);
router.patch("/inbox/sale-drafts/:saleId", controller.updateSaleDraft);
router.delete("/inbox/sale-drafts/:saleId", controller.deleteSaleDraft);
router.post("/inbox/sale-drafts/:saleId/finalize", controller.finalizeSaleDraft);

module.exports = router;