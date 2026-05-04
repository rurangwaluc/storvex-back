"use strict";

const prisma = require("../../config/database");

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

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "boolean") return value;

  const text = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "y", "sent"].includes(text)) return true;
  if (["false", "0", "no", "n", "unsent", "draft"].includes(text)) return false;

  return null;
}

function clampLimit(value, fallback = 50, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

function buildPublicPromotion(promotion) {
  if (!promotion) return null;

  const broadcastCount = Number(promotion._count?.broadcasts || 0);

  return {
    id: promotion.id,
    tenantId: promotion.tenantId,
    title: promotion.title,
    message: promotion.message,
    productId: promotion.productId || null,
    createdById: promotion.createdById,
    sentAt: promotion.sentAt || null,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt || null,

    status: promotion.sentAt ? "SENT" : "DRAFT",
    canEdit: !promotion.sentAt,
    canDelete: !promotion.sentAt && broadcastCount === 0,

    usage: {
      broadcastCount,
      hasBeenUsedInBroadcast: broadcastCount > 0,
    },

    product: promotion.product
      ? {
          id: promotion.product.id,
          name: promotion.product.name,
          sku: promotion.product.sku || null,
          serial: promotion.product.serial || null,
          sellPrice: Number(promotion.product.sellPrice || 0),
          stockQty: Number(promotion.product.stockQty || 0),
        }
      : null,

    createdBy: promotion.createdBy
      ? {
          id: promotion.createdBy.id,
          name: promotion.createdBy.name,
          email: promotion.createdBy.email || null,
          role: promotion.createdBy.role,
        }
      : null,

    strategy: {
      mode: "ONE_STORE_NUMBER",
      customerFacingLabel: "One WhatsApp number for the store",
      note:
        "Promotion content is store-level. Branch targeting is selected later when creating or sending a broadcast.",
    },
  };
}

function promotionInclude() {
  return {
    product: {
      select: {
        id: true,
        name: true,
        sku: true,
        serial: true,
        sellPrice: true,
        stockQty: true,
      },
    },
    createdBy: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    },
    _count: {
      select: {
        broadcasts: true,
      },
    },
  };
}

async function ensureProductBelongsToTenant({ tenantId, productId }) {
  if (!productId) return null;

  const product = await prisma.product.findFirst({
    where: {
      id: String(productId),
      tenantId,
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  if (!product) {
    const err = new Error("PRODUCT_NOT_FOUND");
    err.code = "PRODUCT_NOT_FOUND";
    throw err;
  }

  return product.id;
}

function mapPromotionError(err, res, fallbackMessage) {
  const code = err?.code || err?.message;

  if (code === "UNAUTHORIZED") {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized",
      code,
    });
  }

  if (code === "PROMOTION_NOT_FOUND") {
    return res.status(404).json({
      ok: false,
      message: "Promotion not found",
      code,
    });
  }

  if (code === "PRODUCT_NOT_FOUND") {
    return res.status(404).json({
      ok: false,
      message: "Product not found",
      code,
    });
  }

  if (code === "TITLE_REQUIRED") {
    return res.status(400).json({
      ok: false,
      message: "Promotion title is required",
      code,
    });
  }

  if (code === "MESSAGE_REQUIRED") {
    return res.status(400).json({
      ok: false,
      message: "Promotion message is required",
      code,
    });
  }

  if (code === "SENT_PROMOTION_LOCKED") {
    return res.status(409).json({
      ok: false,
      message: "Sent promotions cannot be edited",
      code,
    });
  }

  if (code === "PROMOTION_USED_IN_BROADCAST") {
    return res.status(409).json({
      ok: false,
      message:
        "This promotion is already used in a broadcast. Keep it for history instead of deleting it.",
      code,
    });
  }

  console.error("WhatsApp promotion unhandled error:", err);

  return res.status(500).json({
    ok: false,
    message: fallbackMessage,
    code: code || "WHATSAPP_PROMOTION_ERROR",
  });
}

async function listPromotions(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      const err = new Error("UNAUTHORIZED");
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const q = normalizeText(req.query?.q);
    const productId = normalizeText(req.query?.productId);
    const sent = normalizeBoolean(req.query?.sent);
    const limit = clampLimit(req.query?.limit, 50, 200);

    const where = {
      tenantId,
      ...(productId ? { productId } : {}),
      ...(sent === true ? { sentAt: { not: null } } : {}),
      ...(sent === false ? { sentAt: null } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { message: { contains: q, mode: "insensitive" } },
              {
                product: {
                  is: {
                    name: { contains: q, mode: "insensitive" },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const promotions = await prisma.promotion.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      include: promotionInclude(),
    });

    return res.json({
      ok: true,
      promotions: promotions.map(buildPublicPromotion),
      strategy: {
        mode: "ONE_STORE_NUMBER",
        customerFacingLabel: "One WhatsApp number for the store",
        internalTargeting:
          "Promotions define the offer. Broadcasts decide which customers receive it, including optional branch-based targeting.",
      },
    });
  } catch (err) {
    console.error("listPromotions error:", err);
    return mapPromotionError(err, res, "Failed to list promotions");
  }
}

async function getPromotion(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      const err = new Error("UNAUTHORIZED");
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const id = normalizeText(req.params?.id);

    const promotion = await prisma.promotion.findFirst({
      where: {
        id,
        tenantId,
      },
      include: promotionInclude(),
    });

    if (!promotion) {
      const err = new Error("PROMOTION_NOT_FOUND");
      err.code = "PROMOTION_NOT_FOUND";
      throw err;
    }

    return res.json({
      ok: true,
      promotion: buildPublicPromotion(promotion),
    });
  } catch (err) {
    console.error("getPromotion error:", err);
    return mapPromotionError(err, res, "Failed to fetch promotion");
  }
}

async function createPromotion(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId || !userId) {
      const err = new Error("UNAUTHORIZED");
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const title = normalizeText(req.body?.title);
    const message = normalizeText(req.body?.message);
    const productId = normalizeText(req.body?.productId);

    if (!title) {
      const err = new Error("TITLE_REQUIRED");
      err.code = "TITLE_REQUIRED";
      throw err;
    }

    if (!message) {
      const err = new Error("MESSAGE_REQUIRED");
      err.code = "MESSAGE_REQUIRED";
      throw err;
    }

    const finalProductId = await ensureProductBelongsToTenant({
      tenantId,
      productId,
    });

    const promotion = await prisma.promotion.create({
      data: {
        tenantId,
        createdById: userId,
        title,
        message,
        productId: finalProductId,
      },
      include: promotionInclude(),
    });

    return res.status(201).json({
      ok: true,
      created: true,
      message: "Promotion created",
      promotion: buildPublicPromotion(promotion),
    });
  } catch (err) {
    console.error("createPromotion error:", err);
    return mapPromotionError(err, res, "Failed to create promotion");
  }
}

async function updatePromotion(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      const err = new Error("UNAUTHORIZED");
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const id = normalizeText(req.params?.id);

    const existing = await prisma.promotion.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        _count: {
          select: {
            broadcasts: true,
          },
        },
      },
    });

    if (!existing) {
      const err = new Error("PROMOTION_NOT_FOUND");
      err.code = "PROMOTION_NOT_FOUND";
      throw err;
    }

    if (existing.sentAt) {
      const err = new Error("SENT_PROMOTION_LOCKED");
      err.code = "SENT_PROMOTION_LOCKED";
      throw err;
    }

    const nextTitle =
      req.body?.title !== undefined ? normalizeText(req.body.title) : existing.title;

    const nextMessage =
      req.body?.message !== undefined ? normalizeText(req.body.message) : existing.message;

    const nextProductId =
      req.body?.productId !== undefined
        ? normalizeText(req.body.productId)
        : existing.productId || null;

    if (!nextTitle) {
      const err = new Error("TITLE_REQUIRED");
      err.code = "TITLE_REQUIRED";
      throw err;
    }

    if (!nextMessage) {
      const err = new Error("MESSAGE_REQUIRED");
      err.code = "MESSAGE_REQUIRED";
      throw err;
    }

    const finalProductId = await ensureProductBelongsToTenant({
      tenantId,
      productId: nextProductId,
    });

    const updated = await prisma.promotion.update({
      where: {
        id: existing.id,
      },
      data: {
        title: nextTitle,
        message: nextMessage,
        productId: finalProductId,
      },
      include: promotionInclude(),
    });

    return res.json({
      ok: true,
      updated: true,
      message: "Promotion updated",
      promotion: buildPublicPromotion(updated),
    });
  } catch (err) {
    console.error("updatePromotion error:", err);
    return mapPromotionError(err, res, "Failed to update promotion");
  }
}

async function deletePromotion(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      const err = new Error("UNAUTHORIZED");
      err.code = "UNAUTHORIZED";
      throw err;
    }

    const id = normalizeText(req.params?.id);

    const existing = await prisma.promotion.findFirst({
      where: {
        id,
        tenantId,
      },
      include: {
        _count: {
          select: {
            broadcasts: true,
          },
        },
      },
    });

    if (!existing) {
      const err = new Error("PROMOTION_NOT_FOUND");
      err.code = "PROMOTION_NOT_FOUND";
      throw err;
    }

    if (existing.sentAt || Number(existing._count?.broadcasts || 0) > 0) {
      const err = new Error("PROMOTION_USED_IN_BROADCAST");
      err.code = "PROMOTION_USED_IN_BROADCAST";
      throw err;
    }

    await prisma.promotion.delete({
      where: {
        id: existing.id,
      },
    });

    return res.json({
      ok: true,
      deleted: true,
      promotionId: existing.id,
      message: "Promotion deleted",
    });
  } catch (err) {
    console.error("deletePromotion error:", err);
    return mapPromotionError(err, res, "Failed to delete promotion");
  }
}

module.exports = {
  listPromotions,
  getPromotion,
  createPromotion,
  updatePromotion,
  deletePromotion,
};