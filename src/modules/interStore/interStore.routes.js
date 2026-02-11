// src/modules/interStore/interStore.routes.js
const express = require("express");
const router = express.Router();

const controller = require("./interStore.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const requireActiveSubscription = require("../../middlewares/requireActiveSubscription");

// All interstore actions require auth + tenant + active subscription
router.use(authenticate, requireTenant, requireActiveSubscription);

// Borrow / create deal
router.post("/", requireRole("OWNER", "CASHIER"), controller.createDeal);

// Mark as RECEIVED
router.patch("/:id/received", requireRole("OWNER", "CASHIER"), controller.markReceived);

// Mark as SOLD
router.patch("/:id/sold", requireRole("OWNER", "CASHIER"), controller.markSold);

// Mark as RETURNED
router.patch("/:id/returned", requireRole("OWNER", "CASHIER"), controller.markReturned);

// ⚠️ If you’re doing installments, you should STOP using /:id/paid.
// If you want to keep it temporarily, leave it. Otherwise remove it.
// router.patch("/:id/paid", requireRole("OWNER"), controller.markPaid);

// Installments: record a payment
router.post("/:id/payments", requireRole("OWNER"), controller.addPayment);

// Installments: list payments for a deal
router.get("/:id/payments", requireRole("OWNER", "CASHIER"), controller.getDealPayments);

// List deals
router.get("/", controller.listDeals);

// Outstanding / overdue
router.get("/outstanding", requireRole("OWNER", "CASHIER"), controller.listOutstanding);
router.get("/overdue", requireRole("OWNER", "CASHIER"), controller.listOverdue);

// Search
router.get("/search", requireRole("OWNER", "CASHIER"), controller.searchDeals);
router.get("/collections/search", requireRole("OWNER", "CASHIER"), controller.searchCollections);

// Audit log
router.get("/audit", requireRole("OWNER"), controller.listDealAudit);

module.exports = router;
