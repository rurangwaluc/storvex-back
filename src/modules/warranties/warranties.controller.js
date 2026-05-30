"use strict";

const prisma = require("../../config/database");
const { renderWarrantyHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");
const { reserveWarrantyDocumentNumberTx } = require("../documents/documentNumber.service");
const {
  parsePagination,
  buildPaginationMeta,
} = require("../../lib/pagination");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getActorUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function getActiveBranchId(req) {
  return req.user?.branchId || req.branch?.id || null;
}

function canViewAllBranches(req) {
  return Boolean(req.user?.canViewAllBranches);
}

function cleanString(value) {
  const s = String(value ?? "").trim();
  return s || null;
}

function oneLine(value) {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return s || null;
}

function hasField(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

function saleDraftWhereFalse() {
  return hasField(prisma.sale, "isDraft") ? { isDraft: false } : {};
}

function parseDateOrNull(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
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

function polishedProductName(value) {
  const clean = oneLine(value) || "—";

  if (clean === "—") return clean;

  const hasUppercase = /[A-Z]/.test(clean);
  const hasLowercase = /[a-z]/.test(clean);

  if (hasLowercase && !hasUppercase) {
    return clean
      .split(" ")
      .map((part) => {
        if (!part) return part;
        return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
      })
      .join(" ");
  }

  return clean;
}

function getLocationName(location) {
  if (!location) return null;

  const name = oneLine(location.name);
  const code = oneLine(location.code);

  if (name) return name;
  if (code) return code;

  return null;
}

function serializeSellingLocation(location) {
  if (!location) return null;

  const name = getLocationName(location);

  return {
    name,
    code: oneLine(location.code),
    status: location.status || null,
    isMain: Boolean(location.isMain),
    label: name,
  };
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

function resolveWarrantyBranchScope(req) {
  const requestedBranchId =
    cleanString(req.query?.branchId) ||
    cleanString(req.headers["x-branch-id"]) ||
    null;

  const allBranchesRequested =
    String(req.query?.allBranches || "")
      .trim()
      .toLowerCase() === "true";

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (allBranchesRequested) {
    if (!canViewAllBranches(req)) {
      const error = new Error("LOCATION_ACCESS_DENIED");
      error.code = "LOCATION_ACCESS_DENIED";
      throw error;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (
      !canViewAllBranches(req) &&
      allowedBranchIds.length > 0 &&
      !allowedBranchIds.includes(requestedBranchId)
    ) {
      const error = new Error("LOCATION_ACCESS_DENIED");
      error.code = "LOCATION_ACCESS_DENIED";
      throw error;
    }

    return {
      mode: "SINGLE_BRANCH",
      branchId: requestedBranchId,
      allowedBranchIds,
    };
  }

  return {
    mode: "SINGLE_BRANCH",
    branchId: getActiveBranchId(req),
    allowedBranchIds,
  };
}

function applyWarrantyBranchScope(where, scope) {
  const next = { ...(where || {}) };

  if (
    scope?.mode === "SINGLE_BRANCH" &&
    scope?.branchId &&
    hasField(prisma.saleWarranty, "branchId")
  ) {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    const error = new Error("LOCATION_REQUIRED");
    error.code = "LOCATION_REQUIRED";
    throw error;
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (
    !canViewAllBranches(req) &&
    allowedBranchIds.length > 0 &&
    !allowedBranchIds.includes(branchId)
  ) {
    const error = new Error("LOCATION_ACCESS_DENIED");
    error.code = "LOCATION_ACCESS_DENIED";
    throw error;
  }

  const location = await prisma.branch.findFirst({
    where: {
      id: branchId,
      tenantId,
      status: {
        in: ["ACTIVE", "CLOSED"],
      },
    },
    select: {
      id: true,
      tenantId: true,
      name: true,
      code: true,
      status: true,
      isMain: true,
    },
  });

  if (!location) {
    const error = new Error("LOCATION_NOT_FOUND");
    error.code = "LOCATION_NOT_FOUND";
    throw error;
  }

  if (location.status !== "ACTIVE") {
    const error = new Error("LOCATION_NOT_ACTIVE");
    error.code = "LOCATION_NOT_ACTIVE";
    throw error;
  }

  return location;
}

function sendLocationError(res, error) {
  const code = String(error?.code || error?.message || "");

  if (code === "LOCATION_REQUIRED" || code === "BRANCH_REQUIRED") {
    return res.status(400).json({
      message: "No active selling location selected",
      code: "LOCATION_REQUIRED",
    });
  }

  if (code === "LOCATION_ACCESS_DENIED" || code === "BRANCH_ACCESS_DENIED") {
    return res.status(403).json({
      message: "You do not have access to this selling location",
      code: "LOCATION_ACCESS_DENIED",
    });
  }

  if (code === "LOCATION_NOT_FOUND" || code === "BRANCH_NOT_FOUND") {
    return res.status(404).json({
      message: "Selling location not found",
      code: "LOCATION_NOT_FOUND",
    });
  }

  if (code === "LOCATION_NOT_ACTIVE" || code === "BRANCH_NOT_ACTIVE") {
    return res.status(409).json({
      message: "Selected selling location is not active",
      code: "LOCATION_NOT_ACTIVE",
    });
  }

  return null;
}

async function resolveSaleByReference(tenantId, saleRef, scope = null) {
  const ref = cleanString(saleRef);
  if (!tenantId || !ref) return null;

  return prisma.sale.findFirst({
    where: {
      tenantId,
      ...saleDraftWhereFalse(),
      ...(scope?.mode === "SINGLE_BRANCH" && scope?.branchId
        ? { branchId: scope.branchId }
        : {}),
      OR: [
        { id: ref },
        ...(hasField(prisma.sale, "receiptNumber") ? [{ receiptNumber: ref }] : []),
        ...(hasField(prisma.sale, "invoiceNumber") ? [{ invoiceNumber: ref }] : []),
      ],
    },
    select: {
      id: true,
      tenantId: true,
      ...(hasField(prisma.sale, "branchId") ? { branchId: true } : {}),
      createdAt: true,
      ...(hasField(prisma.sale, "receiptNumber") ? { receiptNumber: true } : {}),
      ...(hasField(prisma.sale, "invoiceNumber") ? { invoiceNumber: true } : {}),
      ...(hasField(prisma.sale, "branchId")
        ? {
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
                status: true,
                isMain: true,
              },
            },
          }
        : {}),
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          ...(hasField(prisma.customer, "email") ? { email: true } : {}),
          ...(hasField(prisma.customer, "address") ? { address: true } : {}),
          ...(hasField(prisma.customer, "tinNumber") ? { tinNumber: true } : {}),
          ...(hasField(prisma.customer, "idNumber") ? { idNumber: true } : {}),
          ...(hasField(prisma.customer, "notes") ? { notes: true } : {}),
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
              ...(hasField(prisma.product, "serial") ? { serial: true } : {}),
            },
          },
        },
      },
    },
  });
}

function mapWarrantyToListRow(warranty) {
  const sellingLocation = serializeSellingLocation(warranty.branch);

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
    sellingLocation,
    storeLocation: sellingLocation,
  };
}

function mapWarrantyToDetail(warranty, tenant) {
  const sellingLocation =
    serializeSellingLocation(warranty.branch) ||
    (tenant?.sellingLocation
      ? {
          name: oneLine(tenant.sellingLocation),
          code: null,
          status: null,
          isMain: false,
          label: oneLine(tenant.sellingLocation),
        }
      : null);

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
        productName: polishedProductName(unit.saleItem?.product?.name || unit.unitLabel || null),
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

      sellingLocation,
      storeLocation: sellingLocation,

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
            documentHeaderDisplay: tenant.documentHeaderDisplay || "LOGO_AND_NAME",
            documentSizeMode: tenant.documentSizeMode || "AUTO",
            invoiceTerms: tenant.invoiceTerms || null,
            warrantyTerms: tenant.warrantyTerms || null,
            proformaTerms: tenant.proformaTerms || null,
            deliveryNoteTerms: tenant.deliveryNoteTerms || null,
            sellingLocation: sellingLocation?.label || tenant.sellingLocation || null,
            storeLocation: sellingLocation?.label || tenant.storeLocation || null,
          }
        : null,

      units,
    },
  };
}

function warrantyListSelect() {
  return {
    id: true,
    saleId: true,
    ...(hasField(prisma.saleWarranty, "branchId") ? { branchId: true } : {}),
    ...(hasField(prisma.saleWarranty, "branchId")
      ? {
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              isMain: true,
            },
          },
        }
      : {}),
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
        ...(hasField(prisma.sale, "receiptNumber") ? { receiptNumber: true } : {}),
        ...(hasField(prisma.sale, "invoiceNumber") ? { invoiceNumber: true } : {}),
        cashier: {
          select: { name: true },
        },
        customer: {
          select: { name: true, phone: true },
        },
      },
    },
  };
}

function warrantyDetailSelect() {
  return {
    id: true,
    ...(hasField(prisma.saleWarranty, "branchId") ? { branchId: true } : {}),
    ...(hasField(prisma.saleWarranty, "branchId")
      ? {
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
              status: true,
              isMain: true,
            },
          },
        }
      : {}),
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
        ...(hasField(prisma.sale, "receiptNumber") ? { receiptNumber: true } : {}),
        ...(hasField(prisma.sale, "invoiceNumber") ? { invoiceNumber: true } : {}),
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
            ...(hasField(prisma.customer, "email") ? { email: true } : {}),
            ...(hasField(prisma.customer, "address") ? { address: true } : {}),
            ...(hasField(prisma.customer, "tinNumber") ? { tinNumber: true } : {}),
            ...(hasField(prisma.customer, "idNumber") ? { idNumber: true } : {}),
            ...(hasField(prisma.customer, "notes") ? { notes: true } : {}),
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
  };
}

async function listWarranties(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveWarrantyBranchScope(req);
    const q = cleanString(req.query.q);
    const pagination = parsePagination(req.query, {
      defaultLimit: 30,
      maxLimit: 100,
    });

    const where = applyWarrantyBranchScope(
      {
        tenantId,
        sale: {
          tenantId,
          ...saleDraftWhereFalse(),
        },
      },
      scope,
    );

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

    const [total, warranties] = await prisma.$transaction([
      prisma.saleWarranty.count({ where }),
      prisma.saleWarranty.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        select: warrantyListSelect(),
      }),
    ]);

    return res.json({
      warranties: warranties.map(mapWarrantyToListRow),
      count: warranties.length,
      pagination: buildPaginationMeta({
        page: pagination.page,
        limit: pagination.limit,
        total,
      }),
      branchScope: scope,
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("listWarranties error:", error);
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
      return res.status(401).json({ message: "Authenticated user is missing" });
    }

    const activeLocation = await ensureWritableBranchAccessOrThrow(req);

    const scope = {
      mode: "SINGLE_BRANCH",
      branchId: activeLocation.id,
      allowedBranchIds: [activeLocation.id],
    };

    const saleRef = cleanString(req.body?.saleRef || req.body?.saleId);
    const policy = cleanString(req.body?.policy);
    const unitsInput = Array.isArray(req.body?.units) ? req.body.units : [];

    const durationMonths =
      req.body?.durationMonths != null ? Number(req.body.durationMonths || 0) : null;
    const durationDays =
      req.body?.durationDays != null ? Number(req.body.durationDays || 0) : null;

    if (!saleRef) {
      return res.status(400).json({ message: "Sale reference is required" });
    }

    if (!policy) {
      return res.status(400).json({ message: "Warranty policy is required" });
    }

    if (!unitsInput.length) {
      return res.status(400).json({
        message: "At least one warranty item is required",
      });
    }

    const startsAt = parseDateOrNull(req.body?.startsAt) || new Date();
    const explicitEndsAt = parseDateOrNull(req.body?.endsAt);
    const endsAt = deriveEndDate(startsAt, durationMonths, durationDays, explicitEndsAt);

    const sale = await resolveSaleByReference(tenantId, saleRef, scope);

    if (!sale) {
      return res.status(404).json({ message: "Sale not found" });
    }

    const saleItems = Array.isArray(sale.items) ? sale.items : [];

    if (!saleItems.length) {
      return res.status(400).json({
        message: "This sale has no items to cover",
      });
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
      ]),
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
          serial: cleanString(unit.serial) || linkedSaleItem?.serial || null,
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
          (unit.unitLabel || unit.serial || unit.imei1 || unit.imei2),
      );

    if (!normalizedUnits.length) {
      return res.status(400).json({
        message:
          "Warranty items are invalid. Select sold items from the sale before creating warranty coverage.",
      });
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const documentNumber = await reserveWarrantyDocumentNumberTx(tx, {
          tenantId,
          createdAt: new Date(),
        });

        const createData = {
          warrantyNumber: documentNumber.warrantyNumber,
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
        };

        if (hasField(tx.saleWarranty, "branchId")) {
          createData.branchId = sale.branchId || activeLocation.id;
        }

        const warranty = await tx.saleWarranty.create({
          data: createData,
          select: {
            id: true,
            ...(hasField(tx.saleWarranty, "branchId") ? { branchId: true } : {}),
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
      },
    );

    return res.status(201).json({
      created: true,
      warranty: result,
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("createWarranty error:", error);
    return res.status(500).json({ message: "Failed to create warranty" });
  }
}

async function getWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveWarrantyBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Warranty reference is required" });
    }

    const warranty = await prisma.saleWarranty.findFirst({
      where: applyWarrantyBranchScope(
        {
          tenantId,
          sale: {
            tenantId,
            ...saleDraftWhereFalse(),
          },
          OR: [{ id }, { warrantyNumber: id }],
        },
        scope,
      ),
      select: warrantyDetailSelect(),
    });

    if (!warranty) {
      return res.status(404).json({ message: "Warranty not found" });
    }

    const tenant = await buildTenantDocumentBranding(
      prisma,
      tenantId,
      warranty.branchId || null,
    );

    return res.json(mapWarrantyToDetail(warranty, tenant));
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("getWarranty error:", error);
    return res.status(500).json({ message: "Failed to load warranty" });
  }
}

async function updateWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveWarrantyBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Warranty reference is required" });
    }

    const existing = await prisma.saleWarranty.findFirst({
      where: applyWarrantyBranchScope(
        {
          tenantId,
          OR: [{ id }, { warrantyNumber: id }],
        },
        scope,
      ),
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
      req.body?.durationMonths !== undefined
        ? Number(req.body.durationMonths || 0)
        : undefined;

    const durationDays =
      req.body?.durationDays !== undefined
        ? Number(req.body.durationDays || 0)
        : undefined;

    const startsAt =
      req.body?.startsAt !== undefined ? parseDateOrNull(req.body.startsAt) : undefined;

    const endsAt =
      req.body?.endsAt !== undefined ? parseDateOrNull(req.body.endsAt) : undefined;

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
          ...(hasField(tx.saleWarranty, "branchId") ? { branchId: true } : {}),
        },
      });

      const nextStartsAt = startsAt !== undefined ? startsAt : current.startsAt;

      const nextDurationMonths =
        durationMonths !== undefined ? durationMonths : current.durationMonths;

      const nextDurationDays =
        durationDays !== undefined ? durationDays : current.durationDays;

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
          ...(hasField(tx.saleWarranty, "branchId") ? { branchId: true } : {}),
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
              (unit.unitLabel || unit.serial || unit.imei1 || unit.imei2),
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
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("updateWarranty error:", error);
    return res.status(500).json({ message: "Failed to update warranty" });
  }
}

async function deleteWarranty(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveWarrantyBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Warranty reference is required" });
    }

    const existing = await prisma.saleWarranty.findFirst({
      where: applyWarrantyBranchScope(
        {
          tenantId,
          sale: {
            tenantId,
            ...saleDraftWhereFalse(),
          },
          OR: [{ id }, { warrantyNumber: id }],
        },
        scope,
      ),
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
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("deleteWarranty error:", error);
    return res.status(500).json({ message: "Failed to delete warranty" });
  }
}

async function printWarrantyHtml(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).send("Unauthorized");
    }

    const scope = resolveWarrantyBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).send("Warranty reference is required");
    }

    const warranty = await prisma.saleWarranty.findFirst({
      where: applyWarrantyBranchScope(
        {
          tenantId,
          sale: {
            tenantId,
            ...saleDraftWhereFalse(),
          },
          OR: [{ id }, { warrantyNumber: id }],
        },
        scope,
      ),
      select: warrantyDetailSelect(),
    });

    if (!warranty) {
      return res.status(404).send("Warranty not found");
    }

    const tenant = await buildTenantDocumentBranding(
      prisma,
      tenantId,
      warranty.branchId || null,
    );

    const sellingLocation =
      getLocationName(warranty.branch) ||
      oneLine(tenant?.sellingLocation) ||
      oneLine(tenant?.storeLocation) ||
      oneLine(tenant?.locationName) ||
      null;

    const items = (warranty.units || []).map((unit) => ({
      productName: polishedProductName(unit.saleItem?.product?.name || unit.unitLabel || "—"),
      serial: oneLine(unit.serial || unit.imei1 || unit.imei2 || ""),
      sku: oneLine(unit.saleItem?.product?.sku || ""),
      barcode: oneLine(unit.saleItem?.product?.barcode || ""),
      quantity: 1,
      unitPrice: 0,
      price: 0,
      total: 0,
    }));

    const html = renderWarrantyHtml({
      tenant: {
        ...tenant,
        sellingLocation,
        storeLocation: sellingLocation,
        locationName: sellingLocation,
      },
      document: {
        number: warranty.warrantyNumber || warranty.id,
        date: warranty.createdAt,
        createdAt: warranty.createdAt,
      },
      customer: warranty.sale?.customer
        ? {
            name: warranty.sale.customer.name || "Walk-in Customer",
            phone: warranty.sale.customer.phone || null,
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
        _itemCount: items.length,
        _itemCountLabel: "Items covered",
      },
      extra: {
        issuedBy: oneLine(warranty.sale?.cashier?.name) || "Store staff",
        startDate: warranty.startsAt || null,
        endDate: warranty.endsAt || null,
        sellingLocation,
        storeLocation: sellingLocation,
        locationLabel: "Selling location",
        itemCountLabel: "Items covered",
        hideFooterSignature: true,
        warrantyTerms:
          warranty.policy ||
          tenant?.warrantyTerms ||
          "Warranty applies under the store warranty terms.",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (error) {
    const code = String(error?.code || error?.message || "");

    if (code === "LOCATION_ACCESS_DENIED" || code === "BRANCH_ACCESS_DENIED") {
      return res.status(403).send("You do not have access to this selling location");
    }

    console.error("printWarrantyHtml error:", error);
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