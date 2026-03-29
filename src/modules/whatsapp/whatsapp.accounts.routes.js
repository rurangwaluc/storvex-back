const express = require("express");
const router = express.Router();

const controller = require("./whatsapp.accounts.controller");

// auth / tenant / role should already be applied before mounting this router
router.post("/accounts", controller.createAccount);
router.get("/accounts", controller.listAccounts);
router.patch("/accounts/:id", controller.updateAccount);

module.exports = router;