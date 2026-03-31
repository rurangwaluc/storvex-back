const express = require("express");
const router = express.Router();

const inventoryController = require("./inventory.controller");

const authenticate = require("../../middlewares/authenticate");
const requireTenant = require("../../middlewares/requireTenant");
const {
  requireActiveSubscription,
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const requireDbPermission = require("../../middlewares/requireDbPermission");

const readBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
];

const writeBase = [
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireWritableSubscription,
];

// Product search (POS and inventory UI)
router.get(
  "/products/search",
  ...readBase,
  requireDbPermission("product.view"),
  inventoryController.searchProducts
);

// Inventory summary
router.get(
  "/summary",
  ...readBase,
  requireDbPermission("stock.view"),
  inventoryController.getInventorySummary
);

// List products
router.get(
  "/products",
  ...readBase,
  requireDbPermission("product.view"),
  inventoryController.getProducts
);

// Inventory Excel export
router.get(
  "/export.xlsx",
  ...readBase,
  requireDbPermission("product.view"),
  inventoryController.exportInventoryExcel
);

// Whole-store stock history
router.get(
  "/stock-adjustments",
  ...readBase,
  requireDbPermission("stock.history.view"),
  inventoryController.listAllStockAdjustments
);

// Stock history Excel export
router.get(
  "/stock-adjustments/export.xlsx",
  ...readBase,
  requireDbPermission("stock.history.view"),
  inventoryController.exportStockAdjustmentsExcel
);

// Get product by ID
router.get(
  "/products/:id",
  ...readBase,
  requireDbPermission("product.view"),
  inventoryController.getProductById
);

// Create product
router.post(
  "/products",
  ...writeBase,
  requireDbPermission("product.create"),
  inventoryController.createProduct
);

// Update product
router.put(
  "/products/:id",
  ...writeBase,
  requireDbPermission("product.update"),
  inventoryController.updateProduct
);

// Deactivate product
router.delete(
  "/products/:id",
  ...writeBase,
  requireDbPermission("product.deactivate"),
  inventoryController.deleteProduct
);

// Activate product
router.patch(
  "/products/:id/activate",
  ...writeBase,
  requireDbPermission("product.activate"),
  inventoryController.activateProduct
);

// Stock adjustments / restock / manual correction
router.post(
  "/products/:id/stock-adjustments",
  ...writeBase,
  requireDbPermission("stock.adjust"),
  inventoryController.adjustStock
);

// Per-product stock history
router.get(
  "/products/:id/stock-adjustments",
  ...readBase,
  requireDbPermission("stock.history.view"),
  inventoryController.listStockAdjustments
);

// Reorder PDF export
router.get(
  "/reorder.pdf",
  ...readBase,
  requireDbPermission("stock.reorder.export"),
  inventoryController.reorderPdf
);

module.exports = router;