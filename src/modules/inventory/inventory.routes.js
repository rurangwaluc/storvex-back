const express = require("express");
const router = express.Router();
const inventoryController = require("./inventory.controller");
const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const requireRole = require("../../middlewares/requireRole");
const requireActiveSubscription = require("../../middlewares/requireActiveSubscription");


// Create product
router.post(
  "/products",
  authenticate,
  requireTenant,
    requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  inventoryController.createProduct
);

// Get all products
router.get(
  "/products",
  authenticate,
  requireTenant,
    requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  inventoryController.getProducts
);

// Get product by ID
router.get(
  "/products/:id",
  authenticate,
  requireTenant,
    requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  inventoryController.getProductById
);

// Update product
router.put(
  "/products/:id",
  authenticate,
  requireTenant,
    requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  inventoryController.updateProduct
);

// Deactivate product
router.delete(
  "/products/:id",
  authenticate,
  requireTenant,
    requireActiveSubscription,
  requireRole("OWNER", "CASHIER"),
  inventoryController.deleteProduct
);

module.exports = router;
