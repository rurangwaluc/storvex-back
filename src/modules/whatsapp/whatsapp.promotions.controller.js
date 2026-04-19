"use strict";

const prisma = require("../../config/database");

// ─── helpers ──────────────────────────────────────────────────────────────────

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
  return req.user?.id || req.user?.userId || null;
}

function normalizeText(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

function buildPublicPromotion(p) {
  if (!p) return null;
  return {
    id:         p.id,
    tenantId:   p.tenantId,
    title:      p.title,
    message:    p.message,
    productId:  p.productId || null,
    createdById:p.createdById,
    sentAt:     p.sentAt || null,
    createdAt:  p.createdAt,
    product: p.product
      ? {
          id:       p.product.id,
          name:     p.product.name,
          sku:      p.product.sku  || null,
          sellPrice:Number(p.product.sellPrice || 0),
        }
      : null,
    createdBy: p.createdBy
      ? {
          id:   p.createdBy.id,
          name: p.createdBy.name,
          role: p.createdBy.role,
        }
      : null,
  };
}

// ─── List promotions ──────────────────────────────────────────────────────────
// GET /api/whatsapp/promotions
async function listPromotions(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const q     = normalizeText(req.query?.q);
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 100));

    const where = { tenantId };
    if (q) {
      where.OR = [
        { title:   { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
      ];
    }

    const promotions = await prisma.promotion.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      include: {
        product: {
          select: { id: true, name: true, sku: true, sellPrice: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return res.json({ promotions: promotions.map(buildPublicPromotion) });
  } catch (err) {
    console.error("listPromotions error:", err);
    return res.status(500).json({ message: "Failed to list promotions" });
  }
}

// ─── Create promotion ─────────────────────────────────────────────────────────
// POST /api/whatsapp/promotions
async function createPromotion(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId   = getUserId(req);
    if (!tenantId || !userId) return res.status(401).json({ message: "Unauthorized" });

    const title     = normalizeText(req.body?.title);
    const message   = normalizeText(req.body?.message);
    const productId = normalizeText(req.body?.productId);

    if (!title)   return res.status(400).json({ message: "title is required" });
    if (!message) return res.status(400).json({ message: "message is required" });

    // If productId provided, verify it belongs to this tenant
    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!product) return res.status(404).json({ message: "Product not found" });
    }

    const promotion = await prisma.promotion.create({
      data: {
        tenantId,
        createdById: userId,
        title,
        message,
        productId: productId || null,
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true, sellPrice: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return res.status(201).json({
      created: true,
      promotion: buildPublicPromotion(promotion),
    });
  } catch (err) {
    console.error("createPromotion error:", err);
    return res.status(500).json({ message: "Failed to create promotion" });
  }
}

// ─── Update promotion ─────────────────────────────────────────────────────────
// PATCH /api/whatsapp/promotions/:id
async function updatePromotion(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const { id } = req.params;
    if (!id) return res.status(400).json({ message: "Promotion id is required" });

    const existing = await prisma.promotion.findFirst({
      where: { id, tenantId },
      select: { id: true, sentAt: true },
    });

    if (!existing) return res.status(404).json({ message: "Promotion not found" });

    if (existing.sentAt) {
      return res.status(409).json({ message: "Sent promotions cannot be edited" });
    }

    const nextTitle   = req.body?.title   !== undefined ? normalizeText(req.body.title)   : undefined;
    const nextMessage = req.body?.message !== undefined ? normalizeText(req.body.message) : undefined;

    if (nextTitle   !== undefined && !nextTitle)   return res.status(400).json({ message: "title cannot be empty" });
    if (nextMessage !== undefined && !nextMessage) return res.status(400).json({ message: "message cannot be empty" });

    const updated = await prisma.promotion.update({
      where: { id: existing.id },
      data: {
        ...(nextTitle   !== undefined ? { title: nextTitle }     : {}),
        ...(nextMessage !== undefined ? { message: nextMessage } : {}),
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true, sellPrice: true },
        },
        createdBy: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    return res.json({ updated: true, promotion: buildPublicPromotion(updated) });
  } catch (err) {
    console.error("updatePromotion error:", err);
    return res.status(500).json({ message: "Failed to update promotion" });
  }
}

module.exports = { listPromotions, createPromotion, updatePromotion };