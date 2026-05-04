const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.promotions.controller");
const { WHATSAPP_OWNER_ROLES } = require("./whatsapp.roles");

/**
 * WhatsApp promotions
 *
 * Strategy:
 * - Promotions are tenant/store-level.
 * - Customers still receive messages from one store WhatsApp number.
 * - Branch targeting happens later when creating/sending broadcasts.
 * - Promotions only define the offer/message content.
 *
 * Access:
 * - Owner/manager-level roles only.
 */
router.use(
  authenticate,
  requireTenant,
  requireRole(...WHATSAPP_OWNER_ROLES)
);

/**
 * GET /api/whatsapp/promotions
 *
 * Optional query:
 * - q=<search by title/message>
 * - productId=<productId>
 * - sent=true|false
 * - limit=50
 */
router.get("/promotions", controller.listPromotions);

/**
 * POST /api/whatsapp/promotions
 *
 * Body:
 * {
 *   "title": "Weekend offer",
 *   "message": "Get a special discount today.",
 *   "productId": "optional"
 * }
 */
router.post("/promotions", controller.createPromotion);

/**
 * GET /api/whatsapp/promotions/:id
 */
router.get("/promotions/:id", controller.getPromotion);

/**
 * PATCH /api/whatsapp/promotions/:id
 *
 * Only content/settings are updated here.
 * Sending is handled by broadcasts.
 */
router.patch("/promotions/:id", controller.updatePromotion);

/**
 * DELETE /api/whatsapp/promotions/:id
 *
 * Safe delete should be handled in the controller/service if promotion is already used.
 */
router.delete("/promotions/:id", controller.deletePromotion);

module.exports = router;