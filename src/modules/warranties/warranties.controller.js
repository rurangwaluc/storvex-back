"use strict";

const prisma = require("../../config/database");
const { renderWarrantyHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");
const { reserveWarrantyDocumentNumberTx } = require("../documents/documentNumber.service");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getActorUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function cleanString(x) {
  const s = String(x ?? "").trim();
  return s || null;
}

function saleDraftWhereFalse() {
  return typeof prisma.sale.fields?.isDraft !== "undefined" ? { isDraft: false } : {};
}

function parseDateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function deriveEndDate(startsAt, durationMonths, durationDays, explicitEndsAt) {
  if (explicitEndsAt) return explicitEndsAt;

  let result = new Date(startsAt);

  if (Number(durationMonths || 0) > 0) {
    result = addMonths(result, Number(durationMonths || 0));
  }

  if (Number(durationDays || 0) > 0) {
    result = addDays(result, Number(durationDays || 0));
  }

  return result;
}

function normalizeUnitInput(unit, startsAt, endsAt) {
  return {
    saleItemId: cleanString(unit.saleItemId),
    productId: cleanString(unit.productId),
    serial: cleanString(unit.serial),
    imei1: cleanString(unit.imei1),
    imei2: cleanString(unit.imei2),
    unitLabel: cleanString(unit.unitLabel),
    startsAt,
    endsAt,
  };
}

async function resolveSaleByReference(tenantId, saleRef) {
  const ref = cleanString(saleRef);
  if (!tenantId || !ref) return null;

  return prisma.sale.findFirst({
    where: {
      tenantId,
      ...saleDraftWhereFalse(),
      OR: [
        { id: ref },
        ...(typeof prisma.sale.fields?.receiptNumber !== "undefined" ? [{ receiptNumber: ref }] : []),
        ...(typeof prisma.sale.fields?.invoiceNumber !== "undefined" ? [{ invoiceNumber: ref }] : []),
      ],
    },
    select: {
      id: true,
      tenantId: true,
      createdAt: true,
      receiptNumber: typeof prisma.sale.fields?.receiptNumber !== "undefined",
      invoiceNumber: typeof prisma.sale.fields?.invoiceNumber !== "undefined",
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
          ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
          ...(typeof prisma.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
          ...(typeof prisma.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
          ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
        },
      },
      cashier: {
        select: {
          name: true,
        },
      },
      items: {
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          productId: true,
          quantity: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              ...(typeof prisma.product.fields?.serial !== "undefined" ? { serial: true } : {}),
            },
          },
        },
      },
    },
  });
}

function mapWarrantyToListRow(warranty) {
  return {
    id: warranty.id,
    number: warranty.warrantyNumber || null,
    saleId: warranty.saleId,
    customerName: warranty.sale?.customer?.name || "Walk-in Customer",
    customerPhone: warranty.sale?.customer?.phone || null,
    cashierName: warranty.sale?.cashier?.name || null,
    policy: warranty.policy || null,
    durationMonths: warranty.durationMonths ?? null,
    durationDays: warranty.durationDays ?? null,
    startsAt: warranty.startsAt || null,
    endsAt: warranty.endsAt || null,
    unitsCount: Array.isArray(warranty.units) ? warranty.units.length : 0,
    createdAt: warranty.createdAt,
  };
}

function mapWarrantyToDetail(warranty, tenant) {
  const units = Array.isArray(warranty.units)
    ? warranty.units.map((unit) => ({
        id: unit.id,
        saleItemId: unit.saleItemId,
        productId: unit.productId,
        serial: unit.serial || null,
        imei1: unit.imei1 || null,
        imei2: unit.imei2 || null,
        unitLabel: unit.unitLabel || null,
        startsAt: unit.startsAt || null,
        endsAt: unit.endsAt || null,
        createdAt: unit.createdAt,
        productName: unit.saleItem?.product?.name || unit.unitLabel || null,
        sku: unit.saleItem?.product?.sku || null,
        barcode: unit.saleItem?.product?.barcode || null,
      }))
    : [];

  return {
    warranty: {
      id: warranty.id,
      number: warranty.warrantyNumber || null,
      warrantyNumber: warranty.warrantyNumber || null,
      saleId: warranty.saleId,
      policy: warranty.policy || null,
      durationMonths: warranty.durationMonths ?? null,
      durationDays: warranty.durationDays ?? null,
      startsAt: warranty.startsAt || null,
      endsAt: warranty.endsAt || null,
      createdAt: warranty.createdAt,
      customer: warranty.sale?.customer
        ? {
            id: warranty.sale.customer.id,
            name: warranty.sale.customer.name,
            phone: warranty.sale.customer.phone,
            email: warranty.sale.customer.email || null,
            address: warranty.sale.customer.address || null,
            tinNumber: warranty.sale.customer.tinNumber || null,
            idNumber: warranty.sale.customer.idNumber || null,
            notes: warranty.sale.customer.notes || null,
          }
        : null,
      cashierName: warranty.sale?.cashier?.name || null,
      receiptNumber: warranty.sale?.receiptNumber || null,
      invoiceNumber: warranty.sale?.invoiceNumber || null,
      saleDate: warranty.sale?.createdAt || null,
      store: tenant
        ? {
            name: tenant.name || null,
            email: tenant.email || null,
            phone: tenant.phone || null,
            logoUrl: tenant.logoUrl || null,
            logoSignedUrl: tenant.logoSignedUrl || null,
            receiptHeader: tenant.receiptHeader || null,
            receiptFooter: tenant.receiptFooter || null,
            documentPrimaryColor: tenant.documentPrimaryColor || "#1F365C",
            documentAccentColor: tenant.documentAccentColor || "#D8D2C2",
            invoiceTerms: tenant.invoiceTerms || null,
            warrantyTerms: tenant.warrantyTerms || null,
            proformaTerms: tenant.proformaTerms || null,
            deliveryNoteTerms: tenant.deliveryNoteTerms || null,
          }
        : null,
      units,
    },
  };
}

async function listWarranties(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const q = cleanString(req.query.q);

    const where = {
      tenantId,
      sale: {
        tenantId,
        ...saleDraftWhereFalse(),
      },
    };

    if (q) {
      where.OR = [
        { id: { contains: q, mode: "insensitive" } },
        { warrantyNumber: { contains: q, mode: "insensitive" } },
        { saleId: { contains: q, mode: "insensitive" } },
        { sale: { customer: { name: { contains: q, mode: "insensitive" } } } },
        { sale: { customer: { phone: { contains: q, mode: "insensitive" } } } },
        { units: { some: { serial: { contains: q, mode: "insensitive" } } } },
        { units: { some: { imei1: { contains: q, mode: "insensitive" } } } },
        { units: { some: { imei2: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const warranties = await prisma.saleWarranty.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        saleId: true,
        warrantyNumber: true,
        policy: true,
        durationMonths: true,
        durationDays: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        units: {
          select: { id: true },
        },
        sale: {
          select: {
            id: true,
            createdAt: true,
            receiptNumber: true,
            invoiceNumber: true,
            cashier: {
              select: { name: true },
            },
            customer: {
              select: { name: true, phone: true },
            },
          },
        },
      },
    });

    return res.json({
      warranties: warranties.map(mapWarrantyToListRow),
      count: warranties.length,
    });
  } catch (err) {
    console.error("listWarranties error:", err);
    return res.status(500).json({ message: "Failed to load warranties" });
  }
}

async function createWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);
    const createdById = getActorUserId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!createdById) {
      return res.status(401).json({ message: "Authenticated user id is missing" });
    }

    const saleRef = cleanString(req.body?.saleRef || req.body?.saleId);
    const policy = cleanString(req.body?.policy);
    const unitsInput = Array.isArray(req.body?.units) ? req.body.units : [];
    const durationMonths =
      req.body?.durationMonths != null ? Number(req.body.durationMonths || 0) : null;
    const durationDays =
      req.body?.durationDays != null ? Number(req.body.durationDays || 0) : null;

    if (!saleRef) {
      return res.status(400).json({ message: "saleRef is required" });
    }

    if (!policy) {
      return res.status(400).json({ message: "policy is required" });
    }

    if (!unitsInput.length) {
      return res.status(400).json({ message: "At least one warranty unit is required" });
    }

    const startsAt = parseDateOrNull(req.body?.startsAt) || new Date();
    const explicitEndsAt = parseDateOrNull(req.body?.endsAt);
    const endsAt = deriveEndDate(startsAt, durationMonths, durationDays, explicitEndsAt);

    const sale = await resolveSaleByReference(tenantId, saleRef);

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const saleItems = Array.isArray(sale.items) ? sale.items : [];
    if (!saleItems.length) {
      return res.status(400).json({ message: "This sale has no items to warranty" });
    }

    const saleItemMap = new Map(
      saleItems.map((item) => [
        String(item.id),
        {
          saleItemId: String(item.id),
          productId: item.productId ? String(item.productId) : null,
          productName: item.product?.name || null,
          serial: item.product?.serial || null,
        },
      ])
    );

    const normalizedUnits = unitsInput
      .map((unit) => {
        const rawSaleItemId = cleanString(unit.saleItemId);
        const linkedSaleItem = rawSaleItemId ? saleItemMap.get(String(rawSaleItemId)) : null;

        const saleItemId = linkedSaleItem?.saleItemId || null;
        const productId = linkedSaleItem?.productId || cleanString(unit.productId) || null;

        return {
          saleItemId,
          productId,
          serial: cleanString(unit.serial),
          imei1: cleanString(unit.imei1),
          imei2: cleanString(unit.imei2),
          unitLabel: cleanString(unit.unitLabel) || linkedSaleItem?.productName || null,
          startsAt,
          endsAt,
        };
      })
      .filter(
        (unit) =>
          unit.saleItemId &&
          unit.productId &&
          (unit.unitLabel || unit.serial || unit.imei1 || unit.imei2)
      );

    if (!normalizedUnits.length) {
      return res.status(400).json({
        message:
          "Warranty units are invalid. Units must come from selected sold items so saleItemId and productId are available.",
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const doc = await reserveWarrantyDocumentNumberTx(tx, {
          tenantId,
          createdAt: new Date(),
        });

        const warranty = await tx.saleWarranty.create({
          data: {
            warrantyNumber: doc.warrantyNumber,
            policy,
            durationMonths,
            durationDays,
            startsAt,
            endsAt,
            sale: {
              connect: {
                id: sale.id,
              },
            },
            tenant: {
              connect: {
                id: tenantId,
              },
            },
            createdBy: {
              connect: {
                id: createdById,
              },
            },
          },
          select: {
            id: true,
            warrantyNumber: true,
            saleId: true,
            policy: true,
            durationMonths: true,
            durationDays: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
          },
        });

        await tx.saleWarrantyUnit.createMany({
          data: normalizedUnits.map((unit) => ({
            warrantyId: warranty.id,
            saleItemId: unit.saleItemId,
            productId: unit.productId,
            serial: unit.serial || null,
            imei1: unit.imei1 || null,
            imei2: unit.imei2 || null,
            unitLabel: unit.unitLabel || null,
            startsAt: unit.startsAt,
            endsAt: unit.endsAt,
          })),
        });

        return warranty;
      },
      {
        maxWait: 5000,
        timeout: 15000,
      }
    );

    return res.status(201).json({
      created: true,
      warranty: result,
    });
  } catch (err) {
    console.error("createWarranty error:", err);
    return res.status(500).json({ message: "Failed to create warranty" });
  }
}

async function getWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Warranty id is required" });
    }

    const warranty = await prisma.saleWarranty.findFirst({
      where: {
        tenantId,
        sale: {
          tenantId,
          ...saleDraftWhereFalse(),
        },
        OR: [{ id }, { warrantyNumber: id }],
      },
      select: {
        id: true,
        saleId: true,
        tenantId: true,
        createdById: true,
        policy: true,
        durationMonths: true,
        durationDays: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        warrantyNumber: true,
        sale: {
          select: {
            id: true,
            createdAt: true,
            receiptNumber: true,
            invoiceNumber: true,
            cashier: {
              select: {
                name: true,
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
                ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
                ...(typeof prisma.customer.fields?.tinNumber !== "undefined" ? { tinNumber: true } : {}),
                ...(typeof prisma.customer.fields?.idNumber !== "undefined" ? { idNumber: true } : {}),
                ...(typeof prisma.customer.fields?.notes !== "undefined" ? { notes: true } : {}),
              },
            },
          },
        },
        units: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            warrantyId: true,
            saleItemId: true,
            productId: true,
            serial: true,
            imei1: true,
            imei2: true,
            unitLabel: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            saleItem: {
              select: {
                id: true,
                product: {
                  select: {
                    name: true,
                    sku: true,
                    barcode: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!warranty) {
      return res.status(404).json({ message: "Warranty not found" });
    }

    const tenant = await buildTenantDocumentBranding(prisma, tenantId);
    return res.json(mapWarrantyToDetail(warranty, tenant));
  } catch (err) {
    console.error("getWarranty error:", err);
    return res.status(500).json({ message: "Failed to load warranty" });
  }
}

async function updateWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Warranty id is required" });
    }

    const existing = await prisma.saleWarranty.findFirst({
      where: {
        tenantId,
        OR: [{ id }, { warrantyNumber: id }],
      },
      select: {
        id: true,
        saleId: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Warranty not found" });
    }

    const policy = req.body?.policy !== undefined ? cleanString(req.body.policy) : undefined;
    const durationMonths =
      req.body?.durationMonths !== undefined ? Number(req.body.durationMonths || 0) : undefined;
    const durationDays =
      req.body?.durationDays !== undefined ? Number(req.body.durationDays || 0) : undefined;
    const startsAt =
      req.body?.startsAt !== undefined ? parseDateOrNull(req.body.startsAt) : undefined;
    const endsAt = req.body?.endsAt !== undefined ? parseDateOrNull(req.body.endsAt) : undefined;
    const unitsInput = Array.isArray(req.body?.units) ? req.body.units : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.saleWarranty.findUnique({
        where: { id: existing.id },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          durationMonths: true,
          durationDays: true,
        },
      });

      const nextStartsAt = startsAt !== undefined ? startsAt : current.startsAt;
      const nextDurationMonths =
        durationMonths !== undefined ? durationMonths : current.durationMonths;
      const nextDurationDays = durationDays !== undefined ? durationDays : current.durationDays;
      const nextEndsAt =
        endsAt !== undefined
          ? endsAt
          : deriveEndDate(nextStartsAt, nextDurationMonths, nextDurationDays, current.endsAt);

      const updated = await tx.saleWarranty.update({
        where: { id: existing.id },
        data: {
          ...(policy !== undefined ? { policy } : {}),
          ...(durationMonths !== undefined ? { durationMonths } : {}),
          ...(durationDays !== undefined ? { durationDays } : {}),
          ...(startsAt !== undefined ? { startsAt: nextStartsAt } : {}),
          ...(nextEndsAt !== undefined ? { endsAt: nextEndsAt } : {}),
        },
        select: {
          id: true,
          warrantyNumber: true,
          saleId: true,
          policy: true,
          durationMonths: true,
          durationDays: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
        },
      });

      if (unitsInput) {
        const normalizedUnits = unitsInput
          .map((unit) => normalizeUnitInput(unit, nextStartsAt, nextEndsAt))
          .filter(
            (unit) =>
              unit.saleItemId &&
              unit.productId &&
              (unit.unitLabel || unit.serial || unit.imei1 || unit.imei2)
          );

        await tx.saleWarrantyUnit.deleteMany({
          where: { warrantyId: existing.id },
        });

        if (normalizedUnits.length) {
          await tx.saleWarrantyUnit.createMany({
            data: normalizedUnits.map((unit) => ({
              warrantyId: existing.id,
              saleItemId: unit.saleItemId,
              productId: unit.productId,
              serial: unit.serial || null,
              imei1: unit.imei1 || null,
              imei2: unit.imei2 || null,
              unitLabel: unit.unitLabel || null,
              startsAt: unit.startsAt,
              endsAt: unit.endsAt,
            })),
          });
        }
      }

      return updated;
    });

    return res.json({
      updated: true,
      warranty: result,
    });
  } catch (err) {
    console.error("updateWarranty error:", err);
    return res.status(500).json({ message: "Failed to update warranty" });
  }
}

async function deleteWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Warranty id is required" });
    }

    const existing = await prisma.saleWarranty.findFirst({
      where: {
        tenantId,
        sale: {
          tenantId,
          ...saleDraftWhereFalse(),
        },
        OR: [{ id }, { warrantyNumber: id }],
      },
      select: {
        id: true,
        warrantyNumber: true,
        saleId: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Warranty not found" });
    }

    await prisma.saleWarranty.delete({
      where: { id: existing.id },
    });

    return res.json({
      deleted: true,
      id: existing.id,
      warrantyNumber: existing.warrantyNumber || null,
      saleId: existing.saleId || null,
    });
  } catch (err) {
    console.error("deleteWarranty error:", err);
    return res.status(500).json({ message: "Failed to delete warranty" });
  }
}

async function printWarrantyHtml(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).send("Unauthorized");
    }

    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).send("Warranty id is required");
    }

    const warranty = await prisma.saleWarranty.findFirst({
      where: {
        tenantId,
        sale: {
          tenantId,
          ...saleDraftWhereFalse(),
        },
        OR: [{ id }, { warrantyNumber: id }],
      },
      select: {
        id: true,
        saleId: true,
        tenantId: true,
        createdById: true,
        policy: true,
        durationMonths: true,
        durationDays: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        warrantyNumber: true,
        sale: {
          select: {
            id: true,
            createdAt: true,
            receiptNumber: true,
            invoiceNumber: true,
            cashier: {
              select: {
                name: true,
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                ...(typeof prisma.customer.fields?.email !== "undefined" ? { email: true } : {}),
                ...(typeof prisma.customer.fields?.address !== "undefined" ? { address: true } : {}),
              },
            },
          },
        },
        units: {
          orderBy: [{ createdAt: "asc" }],
          select: {
            id: true,
            warrantyId: true,
            saleItemId: true,
            productId: true,
            serial: true,
            imei1: true,
            imei2: true,
            unitLabel: true,
            startsAt: true,
            endsAt: true,
            createdAt: true,
            saleItem: {
              select: {
                id: true,
                product: {
                  select: {
                    name: true,
                    sku: true,
                    barcode: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!warranty) {
      return res.status(404).send("Warranty not found");
    }

    const tenant = await buildTenantDocumentBranding(prisma, tenantId);

    const items = (warranty.units || []).map((unit) => ({
      productName: unit.saleItem?.product?.name || unit.unitLabel || "—",
      serial: unit.serial || unit.imei1 || unit.imei2 || null,
      quantity: 1,
      unitPrice: 0,
      price: 0,
      total: 0,
    }));

    const html = renderWarrantyHtml({
      tenant,
      document: {
        number: warranty.warrantyNumber || warranty.id,
        date: warranty.createdAt,
        createdAt: warranty.createdAt,
      },
      customer: warranty.sale?.customer
        ? {
            name: warranty.sale.customer.name,
            phone: warranty.sale.customer.phone,
            email: warranty.sale.customer.email || null,
            address: warranty.sale.customer.address || null,
          }
        : {
            name: "Walk-in Customer",
            phone: null,
            email: null,
            address: null,
          },
      items,
      totals: {
        subtotal: 0,
        total: 0,
        amountPaid: 0,
        balanceDue: 0,
        currency: "RWF",
      },
      extra: {
        issuedBy: warranty.sale?.cashier?.name || null,
        startDate: warranty.startsAt || null,
        endDate: warranty.endsAt || null,
        warrantyTerms:
          warranty.policy ||
          tenant?.warrantyTerms ||
          "Warranty applies under the store warranty terms.",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("printWarrantyHtml error:", err);
    return res.status(500).send("Failed to render warranty");
  }
}

module.exports = {
  listWarranties,
  createWarranty,
  getWarranty,
  updateWarranty,
  deleteWarranty,
  printWarrantyHtml,
};