const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// CREATE product
async function createProduct(req, res) {
  const { name, sku, serial, costPrice, sellPrice, stockQty } = req.body;

  try {
    const product = await prisma.product.create({
      data: {
        tenantId: req.user.tenantId, // Set tenant ID from authenticated user
        name,
        sku,
        serial,
        costPrice,
        sellPrice,
        stockQty,
      },
    });

    return res.status(201).json(product);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to create product" });
  }
}

// GET all products
async function getProducts(req, res) {
  try {
    const products = await prisma.product.findMany({
      where: { tenantId: req.user.tenantId, isActive: true },
    });
    return res.json(products);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch products" });
  }
}

// GET product by ID
async function getProductById(req, res) {
  const { id } = req.params;

  try {
    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.json(product);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to fetch product" });
  }
}

// UPDATE product
async function updateProduct(req, res) {
  const { id } = req.params;
  const updates = req.body;

  try {
    const product = await prisma.product.update({
      where: { id },
      data: updates,
    });

    return res.json({ message: "Product updated successfully", product });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to update product" });
  }
}

// DELETE product (Mark as inactive)
async function deleteProduct(req, res) {
  const { id } = req.params;

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        isActive: false,
      },
    });

    return res.json({ message: "Product deactivated successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to deactivate product" });
  }
}

module.exports = {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
};
