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
const { PERMISSIONS } = require("../auth/permissions");

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
  requireDbPermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.searchProducts
);

// Inventory summary
router.get(
  "/summary",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getInventorySummary
);

// List products
router.get(
  "/products",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getProducts
);

// Inventory Excel export
router.get(
  "/export.xlsx",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.exportInventoryExcel
);

// Whole-store stock history
router.get(
  "/stock-adjustments",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_HISTORY_VIEW),
  inventoryController.listAllStockAdjustments
);

// Stock history Excel export
router.get(
  "/stock-adjustments/export.xlsx",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_HISTORY_VIEW),
  inventoryController.exportStockAdjustmentsExcel
);

// Get product by ID
router.get(
  "/products/:id",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_VIEW),
  inventoryController.getProductById
);

// Create product
router.post(
  "/products",
  ...writeBase,
  requireDbPermission(PERMISSIONS.INVENTORY_CREATE),
  inventoryController.createProduct
);

// Update product
router.put(
  "/products/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.INVENTORY_EDIT),
  inventoryController.updateProduct
);

// Deactivate product
router.delete(
  "/products/:id",
  ...writeBase,
  requireDbPermission(PERMISSIONS.INVENTORY_EDIT),
  inventoryController.deleteProduct
);

// Activate product
router.patch(
  "/products/:id/activate",
  ...writeBase,
  requireDbPermission(PERMISSIONS.INVENTORY_EDIT),
  inventoryController.activateProduct
);

// Stock adjustments / restock / manual correction
router.post(
  "/products/:id/stock-adjustments",
  ...writeBase,
  requireDbPermission(PERMISSIONS.INVENTORY_ADJUST),
  inventoryController.adjustStock
);

// Per-product stock history
router.get(
  "/products/:id/stock-adjustments",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_HISTORY_VIEW),
  inventoryController.listStockAdjustments
);

// Reorder PDF export
router.get(
  "/reorder.pdf",
  ...readBase,
  requireDbPermission(PERMISSIONS.INVENTORY_REORDER_VIEW),
  inventoryController.reorderPdf
);

module.exports = router;