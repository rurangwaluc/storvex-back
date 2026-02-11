const express = require("express");
const router = express.Router();
const momoRoutes = require("./modules/payments/momo.routes");
const authenticate = require("./middlewares/authenticate");
const paymentsRoutes = require("./modules/payments/payments.routes");

// Placeholder route
router.get("/", (req, res) => {
  res.json({ message: "Storvex API root" });
});

// MOMO route
router.use("/payments/momo", momoRoutes);
router.use("/payments", paymentsRoutes);

module.exports = router;
