const express = require("express");
const router = express.Router();

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");

const controller = require("./whatsapp.broadcasts.controller");
const { WHATSAPP_OWNER_ROLES } = require("./whatsapp.roles");

/**
 * WhatsApp broadcasts
 *
 * Storvex strategy:
 * - One WhatsApp number per store/tenant.
 * - Customers receive messages from the store number.
 * - Branch targeting is internal only. It controls which customers receive
 *   the broadcast; customers do not need to know branch structure.
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
 * GET /api/whatsapp/broadcasts
 *
 * Optional query:
 * - status=DRAFT|QUEUED|SENT|FAILED
 * - accountId=<whatsappAccountId>
 * - q=<search>
 * - limit=50
 */
router.get("/broadcasts", controller.listBroadcasts);

/**
 * POST /api/whatsapp/broadcasts
 *
 * Body:
 * {
 *   "accountId": "optional",
 *   "promotionId": "optional",
 *   "templateName": "promo_template",
 *   "languageCode": "en_US",
 *   "targeting": {
 *     "mode": "ALL_OPTED_IN" |
 *             "BRANCH_CUSTOMERS" |
 *             "CREDIT_CUSTOMERS" |
 *             "OVERDUE_CREDIT_CUSTOMERS" |
 *             "PRODUCT_BUYERS" |
 *             "MANUAL_CUSTOMERS",
 *     "branchId": "optional",
 *     "productId": "optional",
 *     "customerIds": []
 *   }
 * }
 */
router.post("/broadcasts", controller.createBroadcast);

/**
 * GET /api/whatsapp/broadcasts/:id
 */
router.get("/broadcasts/:id", controller.getBroadcast);

/**
 * PATCH /api/whatsapp/broadcasts/:id
 *
 * Only draft broadcasts can be edited.
 */
router.patch("/broadcasts/:id", controller.updateBroadcast);

/**
 * POST /api/whatsapp/broadcasts/:id/queue
 *
 * Moves a draft broadcast into queued status.
 */
router.post("/broadcasts/:id/queue", controller.queueBroadcast);

/**
 * POST /api/whatsapp/broadcasts/:id/send
 *
 * Sends a draft or queued broadcast immediately.
 *
 * Body can include:
 * {
 *   "limit": 50,
 *   "targeting": {
 *     "mode": "ALL_OPTED_IN",
 *     "branchId": null,
 *     "productId": null,
 *     "customerIds": []
 *   }
 * }
 */
router.post("/broadcasts/:id/send", controller.sendBroadcastNow);

module.exports = router;