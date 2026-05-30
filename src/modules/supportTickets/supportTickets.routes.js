const express = require("express");

const controller = require("./supportTickets.controller");

const router = express.Router();

router.get("/", controller.listMySupportTickets);

router.post("/", controller.createSupportTicket);

router.get("/:id", controller.getMySupportTicketById);

router.post("/:id/reply", controller.replyToMySupportTicket);

router.patch("/:id/close", controller.closeMySupportTicket);

module.exports = router;