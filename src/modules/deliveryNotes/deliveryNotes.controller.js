"use strict";

const prisma = require("../../config/database");
const { renderDeliveryNoteHtml } = require("../documents/documentRender.service");
const { buildTenantDocumentBranding } = require("../documents/documentBranding.service");

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

function cleanString(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function toInt(x, fallback = NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function normalizeDeliveryItems(inputItems = []) {
  return (Array.isArray(inputItems) ? inputItems : [])
    .map((item) => ({
      productId: cleanString(item.productId),
      productName: cleanString(item.productName),
      serial: cleanString(item.serial),
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
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
      throw e;
    }

    return {
      mode: "ALL_BRANCHES",
      branchId: null,
      allowedBranchIds,
    };
  }

  if (requestedBranchId) {
    if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(requestedBranchId)) {
      const e = new Error("BRANCH_ACCESS_DENIED");
      e.code = "BRANCH_ACCESS_DENIED";
      throw e;
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

  if (scope?.mode === "SINGLE_BRANCH" && scope?.branchId && typeof prisma.deliveryNote.fields?.branchId !== "undefined") {
    next.branchId = scope.branchId;
  }

  return next;
}

async function ensureWritableBranchAccessOrThrow(req) {
  const tenantId = getTenantId(req);
  const branchId = getActiveBranchId(req);

  if (!tenantId || !branchId) {
    const e = new Error("BRANCH_REQUIRED");
    e.code = "BRANCH_REQUIRED";
    throw e;
  }

  const allowedBranchIds = Array.isArray(req.user?.allowedBranchIds)
    ? req.user.allowedBranchIds
    : [];

  if (!canViewAllBranches(req) && allowedBranchIds.length > 0 && !allowedBranchIds.includes(branchId)) {
    const e = new Error("BRANCH_ACCESS_DENIED");
    e.code = "BRANCH_ACCESS_DENIED";
    throw e;
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
    const e = new Error("BRANCH_NOT_FOUND");
    e.code = "BRANCH_NOT_FOUND";
    throw e;
  }

  if (branch.status !== "ACTIVE") {
    const e = new Error("BRANCH_NOT_ACTIVE");
    e.code = "BRANCH_NOT_ACTIVE";
    throw e;
  }

  return branch;
}

function mapDeliveryNoteListRow(row) {
  return {
    id: row.id,
    branchId: row.branchId || null,
    branch: row.branch || null,
    number: String(row.number),
    date: row.date,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    deliveredBy: row.deliveredBy || null,
    receivedBy: row.receivedBy || null,
    status: "DELIVERED",
    itemsCount: Array.isArray(row.items) ? row.items.length : 0,
    createdAt: row.createdAt,
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

async function listDeliveryNotes(req, res) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const scope = resolveDeliveryNoteBranchScope(req);
    const q = cleanString(req.query.q);

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

    const rows = await prisma.deliveryNote.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      select: {
        id: true,
        ...(typeof prisma.deliveryNote.fields?.branchId !== "undefined" ? { branchId: true } : {}),
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
    });

    return res.json({
      deliveryNotes: rows.map(mapDeliveryNoteListRow),
      count: rows.length,
      branchScope: scope,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("listDeliveryNotes error:", err);
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
      deliveryNote: note,
    });
  } catch (err) {
    const code = err?.code;
    const msg = String(err?.message || "");

    if (code === "BRANCH_REQUIRED" || msg === "BRANCH_REQUIRED") {
      return res.status(400).json({ message: "No active branch selected", code: "BRANCH_REQUIRED" });
    }
    if (code === "BRANCH_ACCESS_DENIED" || msg === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied", code: "BRANCH_ACCESS_DENIED" });
    }
    if (code === "BRANCH_NOT_FOUND" || msg === "BRANCH_NOT_FOUND") {
      return res.status(404).json({ message: "Branch not found" });
    }
    if (code === "BRANCH_NOT_ACTIVE" || msg === "BRANCH_NOT_ACTIVE") {
      return res.status(409).json({ message: "Selected branch is not active" });
    }

    console.error("createDeliveryNote error:", err);
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
      return res.status(400).json({ message: "Delivery note id is required" });
    }

    const note = await findDeliveryNoteById(tenantId, id, scope);

    if (!note) {
      return res.status(404).json({ message: "Delivery note not found" });
    }

    return res.json({ deliveryNote: note, branchScope: scope });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("getDeliveryNote error:", err);
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
      return res.status(400).json({ message: "Delivery note id is required" });
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
      req.body.receivedByPhone !== undefined ? cleanString(req.body.receivedByPhone) : undefined;
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
      deliveryNote: result,
    });
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("updateDeliveryNote error:", err);
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
      return res.status(400).json({ message: "Delivery note id is required" });
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
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).json({ message: "Branch access denied" });
    }

    console.error("deleteDeliveryNote error:", err);
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
      typeof note.branchId !== "undefined" ? note.branchId : null
    );

    const html = renderDeliveryNoteHtml({
      tenant,
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
      items: (note.items || []).map((it) => ({
        productName: it.productName,
        serial: it.serial,
        quantity: it.quantity,
      })),
      totals: {
        currency: "RWF",
      },
      extra: {
        deliveredBy: note.deliveredBy,
        receivedBy: note.receivedBy,
        receivedByPhone: note.receivedByPhone,
        notes: note.notes || tenant?.deliveryNoteTerms || null,
        badgeText: "DELIVERY",
        branchName: note.branch?.name || null,
        branchCode: note.branch?.code || null,
      },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    if (String(err?.code || err?.message || "") === "BRANCH_ACCESS_DENIED") {
      return res.status(403).send("Branch access denied");
    }

    console.error("printDeliveryNoteHtml error:", err);
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