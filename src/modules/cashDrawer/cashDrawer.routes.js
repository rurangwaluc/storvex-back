const express = require("express");
const prisma = require("../../config/database");

const router = express.Router();

// -------- utils --------
function toBigIntAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return BigInt(Math.round(n)); // RWF integer
}

function assertCanManageDrawer(user) {
  const role = String(user?.role || "");
  if (role !== "OWNER" && role !== "MANAGER" && role !== "CASHIER") {
    const err = new Error("Not allowed");
    err.statusCode = 403;
    throw err;
  }
}

function normalizeMovementType(x) {
  const v = String(x || "").toUpperCase();
  if (v === "IN" || v === "OUT") return v;
  return null;
}

function normalizeMovementReason(x, type /* IN|OUT */) {
  const v = String(x || "").toUpperCase().trim();
  const allowed = new Set(["FLOAT", "WITHDRAWAL", "DEPOSIT", "EXPENSE", "OTHER"]);
  if (allowed.has(v)) return v;

  if (type === "IN") return "DEPOSIT";
  if (type === "OUT") return "WITHDRAWAL";
  return "OTHER";
}

// -------- db helpers --------
async function getOpenSession(tenantId) {
  const rows = await prisma.$queryRaw`
    select
      id,
      tenant_id,
      opened_by,
      opened_at,
      opening_cash,
      closed_by,
      closed_at,
      counted_cash,
      close_note,
      created_at
    from public.cash_sessions
    where tenant_id = ${String(tenantId)}::uuid
      and closed_at is null
    order by opened_at desc
    limit 1
  `;
  return rows?.[0] || null;
}

async function getTenantDrawerSettings(tenantId) {
  /**
   * FIX:
   * Your error says: "operator does not exist: text = uuid"
   * That means public."Tenant".id is TEXT (or being treated as TEXT).
   *
   * So we compare TEXT-to-TEXT.
   */
  const rows = await prisma.$queryRaw`
    select id, cash_drawer_block_cash_sales
    from public."Tenant"
    where id::text = ${String(tenantId)}::text
    limit 1
  `;
  return rows?.[0] || null;
}

// -------- routes --------

// GET /api/cash-drawer/status
router.get("/status", async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const [settings, open] = await Promise.all([
      getTenantDrawerSettings(tenantId),
      getOpenSession(tenantId),
    ]);

    return res.json({
      settings: settings
        ? { blockCashSales: Boolean(settings.cash_drawer_block_cash_sales) }
        : { blockCashSales: true },

      openSession: open
        ? {
            id: open.id,
            openedAt: open.opened_at,
            openedBy: open.opened_by,
            openingCash: String(open.opening_cash ?? 0),
            closedAt: open.closed_at,
            closedBy: open.closed_by,
            countedCash: open.counted_cash != null ? String(open.counted_cash) : null,
            closeNote: open.close_note ?? null,
          }
        : null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/cash-drawer/movements?limit=100
router.get("/movements", async (req, res, next) => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));

    const open = await getOpenSession(tenantId);
    if (!open) return res.json({ sessionId: null, movements: [] });

    const rows = await prisma.$queryRaw`
      select
        id,
        type,
        reason,
        amount,
        note,
        created_at,
        created_by
      from public.cash_movements
      where tenant_id = ${String(tenantId)}::uuid
        and session_id = ${String(open.id)}::uuid
      order by created_at desc
      limit ${limit}
    `;

    return res.json({
      sessionId: open.id,
      movements: (rows || []).map((r) => ({
        id: r.id,
        type: r.type,
        reason: r.reason,
        amount: String(r.amount),
        note: r.note,
        createdAt: r.created_at,
        createdBy: r.created_by,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/cash-drawer/open
router.post("/open", async (req, res, next) => {
  try {
    const user = req.user;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    assertCanManageDrawer(user);

    const existing = await getOpenSession(tenantId);
    if (existing) return res.status(409).json({ message: "Drawer already open" });

    const openingCash = toBigIntAmount(req.body?.openingCash ?? req.body?.openingBalance ?? 0);
    if (openingCash == null) return res.status(400).json({ message: "Invalid openingCash" });

    const rows = await prisma.$queryRaw`
      insert into public.cash_sessions
        (tenant_id, opened_by, opening_cash)
      values
        (${String(tenantId)}::uuid, ${String(user.id)}::uuid, ${openingCash})
      returning
        id, opened_at, opened_by, opening_cash
    `;

    const session = rows?.[0];

    return res.json({
      session: {
        id: session.id,
        openedAt: session.opened_at,
        openedBy: session.opened_by,
        openingCash: String(session.opening_cash ?? 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/cash-drawer/close
router.post("/close", async (req, res, next) => {
  try {
    const user = req.user;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    assertCanManageDrawer(user);

    const open = await getOpenSession(tenantId);
    if (!open) return res.status(409).json({ message: "Drawer is not open" });

    const countedCash = toBigIntAmount(req.body?.countedCash ?? req.body?.closingCash ?? req.body?.closingBalance);
    if (countedCash == null) return res.status(400).json({ message: "Invalid countedCash/closingCash" });

    const closeNote = String(req.body?.note || "").trim() || null;

    const rows = await prisma.$queryRaw`
      update public.cash_sessions
      set
        closed_at = now(),
        closed_by = ${String(user.id)}::uuid,
        counted_cash = ${countedCash},
        close_note = ${closeNote}
      where id = ${String(open.id)}::uuid
        and tenant_id = ${String(tenantId)}::uuid
        and closed_at is null
      returning
        id, closed_at, closed_by, counted_cash, close_note
    `;

    const session = rows?.[0];

    return res.json({
      session: {
        id: session.id,
        closedAt: session.closed_at,
        closedBy: session.closed_by,
        countedCash: session.counted_cash != null ? String(session.counted_cash) : null,
        closeNote: session.close_note ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/cash-drawer/movements
router.post("/movements", async (req, res, next) => {
  try {
    const user = req.user;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(401).json({ message: "Unauthorized" });

    assertCanManageDrawer(user);

    const open = await getOpenSession(tenantId);
    if (!open) return res.status(409).json({ message: "Drawer is not open" });

    const type = normalizeMovementType(req.body?.type);
    if (!type) return res.status(400).json({ message: "Invalid type (IN|OUT)" });

    const amount = toBigIntAmount(req.body?.amount);
    if (amount == null || amount <= 0n) return res.status(400).json({ message: "Invalid amount" });

    const note = String(req.body?.note || "").trim() || null;
    const reason = normalizeMovementReason(req.body?.reason, type);

    const rows = await prisma.$queryRaw`
      insert into public.cash_movements
        (tenant_id, session_id, type, reason, amount, note, created_by)
      values
        (
          ${String(tenantId)}::uuid,
          ${String(open.id)}::uuid,
          ${type}::cash_movement_type,
          ${reason}::cash_movement_reason,
          ${amount},
          ${note},
          ${String(user.id)}::uuid
        )
      returning
        id, type, reason, amount, note, created_at, created_by
    `;

    const movement = rows?.[0];

    return res.json({
      movement: {
        id: movement.id,
        type: movement.type,
        reason: movement.reason,
        amount: String(movement.amount),
        note: movement.note,
        createdAt: movement.created_at,
        createdBy: movement.created_by,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;