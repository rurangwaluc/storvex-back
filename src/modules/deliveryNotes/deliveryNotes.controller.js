"use strict";

const prisma = require("../../config/database");
const { renderDeliveryNoteHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");
const {
  parsePagination,
  buildPaginationMeta,
} = require("../../lib/pagination");

function getTenantId(req) {
  return req.user?.tenantId || null;
}

function getUserId(req) {
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

function toInt(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
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

function getLocationName(branch) {
  if (!branch) return null;

  const name = oneLine(branch.name);
  const code = oneLine(branch.code);

  if (name) return name;
  if (code) return code;

  return null;
}

function serializeSellingLocation(branch) {
  if (!branch) return null;

  return {
    name: getLocationName(branch),
    code: oneLine(branch.code),
    status: branch.status || null,
    isMain: Boolean(branch.isMain),
    label: getLocationName(branch),
  };
}

function normalizeDeliveryItems(inputItems = []) {
  return (Array.isArray(inputItems) ? inputItems : [])
    .map((item) => ({
      productId: cleanString(item.productId),
      productName: polishedProductName(item.productName),
      serial: oneLine(item.serial),
      quantity: toInt(item.quantity, 1),
    }))
    .filter((item) => item.productName && item.quantity > 0);
}

function resolveDeliveryNoteBranchScope(req) {
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

function applyDeliveryBranchScope(where, scope) {
  const next = { ...(where || {}) };

  if (
    scope?.mode === "SINGLE_BRANCH" &&
    scope?.branchId &&
    typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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

  const branch = await prisma.branch.findFirst({
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

  if (!branch) {
    const error = new Error("LOCATION_NOT_FOUND");
    error.code = "LOCATION_NOT_FOUND";
    throw error;
  }

  if (branch.status !== "ACTIVE") {
    const error = new Error("LOCATION_NOT_ACTIVE");
    error.code = "LOCATION_NOT_ACTIVE";
    throw error;
  }

  return branch;
}

function mapDeliveryNoteListRow(row) {
  const sellingLocation = serializeSellingLocation(row.branch);

  return {
    id: row.id,
    number: String(row.number),
    date: row.date,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    deliveredBy: row.deliveredBy || null,
    receivedBy: row.receivedBy || null,
    status: "DELIVERED",
    itemsCount: Array.isArray(row.items) ? row.items.length : 0,
    createdAt: row.createdAt,
    sellingLocation,
    storeLocation: sellingLocation,
  };
}

async function findDeliveryNoteById(tenantId, id, scope = null) {
  if (!tenantId || !id) return null;

  return prisma.deliveryNote.findFirst({
    where: applyDeliveryBranchScope({ id, tenantId }, scope),
    include: {
      ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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
      items: {
        orderBy: [{ createdAt: "asc" }],
      },
    },
  });
}

function mapDeliveryNoteDetail(note) {
  const sellingLocation = serializeSellingLocation(note.branch);

  return {
    ...note,
    sellingLocation,
    storeLocation: sellingLocation,
    items: Array.isArray(note.items)
      ? note.items.map((item) => ({
          ...item,
          productName: polishedProductName(item.productName),
          serial: oneLine(item.serial),
          quantity: Number(item.quantity || 0),
        }))
      : [],
  };
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

async function listDeliveryNotes(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const q = cleanString(req.query.q);
    const pagination = parsePagination(req.query, {
      defaultLimit: 30,
      maxLimit: 100,
    });

    let where = { tenantId };
    where = applyDeliveryBranchScope(where, scope);

    if (q) {
      const maybeNumber = Number(q);

      where.OR = [
        { customerName: { contains: q, mode: "insensitive" } },
        { customerPhone: { contains: q, mode: "insensitive" } },
        { receivedBy: { contains: q, mode: "insensitive" } },
        { deliveredBy: { contains: q, mode: "insensitive" } },
        ...(Number.isFinite(maybeNumber) ? [{ number: maybeNumber }] : []),
      ];
    }

    const [total, rows] = await prisma.$transaction([
      prisma.deliveryNote.count({ where }),
      prisma.deliveryNote.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
            ? { branchId: true }
            : {}),
          ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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
          number: true,
          date: true,
          customerName: true,
          customerPhone: true,
          deliveredBy: true,
          receivedBy: true,
          createdAt: true,
          items: {
            select: { id: true },
          },
        },
      }),
    ]);

    return res.json({
      deliveryNotes: rows.map(mapDeliveryNoteListRow),
      count: rows.length,
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

    console.error("listDeliveryNotes error:", error);
    return res.status(500).json({ message: "Failed to load delivery notes" });
  }
}

async function createDeliveryNote(req, res) {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const activeBranch = await ensureWritableBranchAccessOrThrow(req);

    const customerName = cleanString(req.body.customerName);
    const customerPhone = cleanString(req.body.customerPhone);
    const customerAddress = cleanString(req.body.customerAddress);
    const deliveredBy = cleanString(req.body.deliveredBy);
    const receivedBy = cleanString(req.body.receivedBy);
    const receivedByPhone = cleanString(req.body.receivedByPhone);
    const notes = cleanString(req.body.notes);
    const saleId = cleanString(req.body.saleId);

    const items = normalizeDeliveryItems(req.body.items);

    if (!customerName) {
      return res.status(400).json({ message: "Customer name is required" });
    }

    if (!items.length) {
      return res.status(400).json({ message: "At least one delivery item is required" });
    }

    const counter = await prisma.deliveryNoteCounter.upsert({
      where: { tenantId },
      update: { nextNumber: { increment: 1 } },
      create: { tenantId, nextNumber: 2 },
      select: { nextNumber: true },
    });

    const number = Number(counter.nextNumber) - 1;

    const createData = {
      tenantId,
      number,
      saleId,
      customerName,
      customerPhone,
      customerAddress,
      deliveredBy,
      receivedBy,
      receivedByPhone,
      notes,
      createdById: userId,
      items: {
        create: items,
      },
    };

    if (typeof prisma.deliveryNote.fields?.branchId !== "undefined") {
      createData.branchId = activeBranch.id;
    }

    const note = await prisma.deliveryNote.create({
      data: createData,
      include: {
        ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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
        items: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });

    return res.status(201).json({
      deliveryNote: mapDeliveryNoteDetail(note),
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("createDeliveryNote error:", error);
    return res.status(500).json({ message: "Failed to create delivery note" });
  }
}

async function getDeliveryNote(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Delivery note reference is required" });
    }

    const note = await findDeliveryNoteById(tenantId, id, scope);

    if (!note) {
      return res.status(404).json({ message: "Delivery note not found" });
    }

    return res.json({
      deliveryNote: mapDeliveryNoteDetail(note),
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("getDeliveryNote error:", error);
    return res.status(500).json({ message: "Failed to load delivery note" });
  }
}

async function updateDeliveryNote(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Delivery note reference is required" });
    }

    const existing = await prisma.deliveryNote.findFirst({
      where: applyDeliveryBranchScope({ id, tenantId }, scope),
      select: {
        id: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Delivery note not found" });
    }

    const customerName =
      req.body.customerName !== undefined ? cleanString(req.body.customerName) : undefined;
    const customerPhone =
      req.body.customerPhone !== undefined ? cleanString(req.body.customerPhone) : undefined;
    const customerAddress =
      req.body.customerAddress !== undefined ? cleanString(req.body.customerAddress) : undefined;
    const deliveredBy =
      req.body.deliveredBy !== undefined ? cleanString(req.body.deliveredBy) : undefined;
    const receivedBy =
      req.body.receivedBy !== undefined ? cleanString(req.body.receivedBy) : undefined;
    const receivedByPhone =
      req.body.receivedByPhone !== undefined
        ? cleanString(req.body.receivedByPhone)
        : undefined;
    const notes = req.body.notes !== undefined ? cleanString(req.body.notes) : undefined;
    const saleId = req.body.saleId !== undefined ? cleanString(req.body.saleId) : undefined;

    const hasItems = Array.isArray(req.body.items);
    const items = hasItems ? normalizeDeliveryItems(req.body.items) : null;

    if (customerName !== undefined && !customerName) {
      return res.status(400).json({ message: "Customer name is required" });
    }

    if (hasItems && !items.length) {
      return res.status(400).json({ message: "At least one delivery item is required" });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (hasItems) {
        await tx.deliveryNoteItem.deleteMany({
          where: { deliveryNoteId: existing.id },
        });

        await tx.deliveryNoteItem.createMany({
          data: items.map((item) => ({
            deliveryNoteId: existing.id,
            productId: item.productId || null,
            productName: item.productName,
            serial: item.serial || null,
            quantity: item.quantity,
          })),
        });
      }

      await tx.deliveryNote.update({
        where: { id: existing.id },
        data: {
          ...(customerName !== undefined ? { customerName } : {}),
          ...(customerPhone !== undefined ? { customerPhone } : {}),
          ...(customerAddress !== undefined ? { customerAddress } : {}),
          ...(deliveredBy !== undefined ? { deliveredBy } : {}),
          ...(receivedBy !== undefined ? { receivedBy } : {}),
          ...(receivedByPhone !== undefined ? { receivedByPhone } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(saleId !== undefined ? { saleId } : {}),
        },
      });

      return tx.deliveryNote.findUnique({
        where: { id: existing.id },
        include: {
          ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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
          items: {
            orderBy: [{ createdAt: "asc" }],
          },
        },
      });
    });

    return res.json({
      updated: true,
      deliveryNote: mapDeliveryNoteDetail(result),
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("updateDeliveryNote error:", error);
    return res.status(500).json({ message: "Failed to update delivery note" });
  }
}

async function deleteDeliveryNote(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).json({ message: "Delivery note reference is required" });
    }

    const existing = await prisma.deliveryNote.findFirst({
      where: applyDeliveryBranchScope({ id, tenantId }, scope),
      select: { id: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Delivery note not found" });
    }

    await prisma.deliveryNote.delete({
      where: { id: existing.id },
    });

    return res.json({
      deleted: true,
      id: existing.id,
    });
  } catch (error) {
    const handled = sendLocationError(res, error);
    if (handled) return handled;

    console.error("deleteDeliveryNote error:", error);
    return res.status(500).json({ message: "Failed to delete delivery note" });
  }
}

async function printDeliveryNoteHtml(req, res) {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      return res.status(401).send("Unauthorized");
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const id = String(req.params.id || "").trim();

    if (!id) {
      return res.status(400).send("Delivery note reference is required");
    }

    const note = await prisma.deliveryNote.findFirst({
      where: applyDeliveryBranchScope({ id, tenantId }, scope),
      include: {
        ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined"
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
        items: {
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });

    if (!note) {
      return res.status(404).send("Delivery note not found");
    }

    const tenant = await buildTenantDocumentBranding(
      prisma,
      tenantId,
      note.branchId || null,
    );

    const sellingLocation =
      getLocationName(note.branch) ||
      oneLine(tenant?.sellingLocation) ||
      oneLine(tenant?.storeLocation) ||
      oneLine(tenant?.locationName) ||
      null;

    const items = (note.items || []).map((item) => ({
      productName: polishedProductName(item.productName),
      serial: oneLine(item.serial),
      quantity: Number(item.quantity || 0),
    }));

    const html = renderDeliveryNoteHtml({
      tenant: {
        ...tenant,
        sellingLocation,
        storeLocation: sellingLocation,
        locationName: sellingLocation,
      },
      document: {
        number: String(note.number),
        date: note.date || note.createdAt,
        createdAt: note.createdAt,
      },
      customer: {
        name: note.customerName,
        phone: note.customerPhone,
        address: note.customerAddress,
      },
      items,
      totals: {
        currency: "RWF",
        _itemCount: items.length,
      },
      extra: {
        deliveredBy: oneLine(note.deliveredBy) || "Store staff",
        receivedBy: oneLine(note.receivedBy) || "Receiver",
        receivedByPhone: oneLine(note.receivedByPhone) || null,
        notes:
          note.notes ||
          tenant?.deliveryNoteTerms ||
          "Please confirm that all delivered items were received in good condition.",
        badgeText: "DELIVERY",
        sellingLocation,
        storeLocation: sellingLocation,
        locationLabel: "Store location",
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    const code = String(error?.code || error?.message || "");

    if (code === "LOCATION_ACCESS_DENIED" || code === "BRANCH_ACCESS_DENIED") {
      return res.status(403).send("You do not have access to this selling location");
    }

    console.error("printDeliveryNoteHtml error:", error);
    return res.status(500).send("Failed to render delivery note");
  }
}

module.exports = {
  listDeliveryNotes,
  createDeliveryNote,
  getDeliveryNote,
  updateDeliveryNote,
  deleteDeliveryNote,
  printDeliveryNoteHtml,
};