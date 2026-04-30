const express = require("express");
const prisma = require("../../config/database");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const router = express.Router();

// -------- utils --------

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function toBigIntAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return BigInt(Math.round(n)); // RWF integer
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

function resolveActiveBranchId(req) {
  return (
    cleanString(req.user?.activeBranchId) ||
    cleanString(req.user?.branchId) ||
    cleanString(req.branchAccess?.activeBranchId) ||
    cleanString(req.branch?.id) ||
    null
  );
}

function ensureBranchContext(req, res) {
  const tenantId = cleanString(req.user?.tenantId);
  const branchId = resolveActiveBranchId(req);

  if (!tenantId) {
    res.status(401).json({
      message: "Unauthorized",
      code: "AUTH_REQUIRED",
    });
    return null;
  }

  if (!branchId) {
    res.status(400).json({
      message: "Active branch is required",
      code: "BRANCH_REQUIRED",
    });
    return null;
  }

  if (req.user?.canOperateInActiveBranch === false) {
    res.status(403).json({
      message: "You cannot operate in this branch",
      code: "BRANCH_OPERATION_DENIED",
      branchId,
    });
    return null;
  }

  return { tenantId, branchId };
}

function toCashSessionDto(session) {
  if (!session) return null;

  return {
    id: session.id,
    tenantId: session.tenant_id,
    branchId: session.branch_id,
    openedAt: session.opened_at,
    openedBy: session.opened_by,
    openingCash: String(session.opening_cash ?? 0),
    closedAt: session.closed_at ?? null,
    closedBy: session.closed_by ?? null,
    countedCash: session.counted_cash != null ? String(session.counted_cash) : null,
    closeNote: session.close_note ?? null,
    createdAt: session.created_at ?? null,
  };
}

function toCashMovementDto(movement) {
  if (!movement) return null;

  return {
    id: movement.id,
    tenantId: movement.tenant_id,
    branchId: movement.branch_id,
    sessionId: movement.session_id,
    type: movement.type,
    reason: movement.reason,
    amount: String(movement.amount ?? 0),
    note: movement.note ?? null,
    createdAt: movement.created_at,
    createdBy: movement.created_by,
  };
}

// -------- db helpers --------

async function getOpenSession(tenantId, branchId) {
  const rows = await prisma.$queryRaw`
    select
      id,
      tenant_id,
      branch_id,
      opened_by,
      opened_at,
      opening_cash,
      closed_by,
      closed_at,
      counted_cash,
      close_note,
      created_at
    from public.cash_sessions
    where tenant_id::text = ${String(tenantId)}::text
      and branch_id::text = ${String(branchId)}::text
      and closed_at is null
    order by opened_at desc
    limit 1
  `;

  return rows?.[0] || null;
}

async function getTenantDrawerSettings(tenantId) {
  const rows = await prisma.$queryRaw`
    select id, cash_drawer_block_cash_sales
    from public."Tenant"
    where id::text = ${String(tenantId)}::text
    limit 1
  `;

  return rows?.[0] || null;
}

async function getBranchSummary(tenantId, branchId) {
  const rows = await prisma.$queryRaw`
    select
      id,
      "tenantId",
      name,
      code,
      type,
      status,
      "isMain"
    from public."Branch"
    where id::text = ${String(branchId)}::text
      and "tenantId"::text = ${String(tenantId)}::text
      and status in ('ACTIVE', 'CLOSED')
    limit 1
  `;

  return rows?.[0] || null;
}

async function assertBranchIsOperable(tenantId, branchId) {
  const branch = await getBranchSummary(tenantId, branchId);

  if (!branch) {
    return {
      ok: false,
      status: 404,
      body: {
        message: "Branch not found",
        code: "BRANCH_NOT_FOUND",
        branchId,
      },
    };
  }

  if (branch.status !== "ACTIVE") {
    return {
      ok: false,
      status: 409,
      body: {
        message: "This branch is not active",
        code: "BRANCH_NOT_ACTIVE",
        branchId,
        branchStatus: branch.status,
      },
    };
  }

  return { ok: true, branch };
}

// -------- routes --------

// GET /api/cash-drawer/status
router.get(
  "/status",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_VIEW),
  async (req, res, next) => {
    try {
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;

      const [settings, open, branch] = await Promise.all([
        getTenantDrawerSettings(tenantId),
        getOpenSession(tenantId, branchId),
        getBranchSummary(tenantId, branchId),
      ]);

      return res.json({
        branch: branch
          ? {
              id: branch.id,
              tenantId: branch.tenantId,
              name: branch.name,
              code: branch.code,
              type: branch.type,
              status: branch.status,
              isMain: Boolean(branch.isMain),
            }
          : null,
        settings: settings
          ? { blockCashSales: Boolean(settings.cash_drawer_block_cash_sales) }
          : { blockCashSales: true },
        openSession: toCashSessionDto(open),
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/cash-drawer/movements?limit=100
router.get(
  "/movements",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_VIEW),
  async (req, res, next) => {
    try {
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;

      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));

      const open = await getOpenSession(tenantId, branchId);

      if (!open) {
        return res.json({
          branchId,
          sessionId: null,
          movements: [],
        });
      }

      const rows = await prisma.$queryRaw`
        select
          id,
          tenant_id,
          branch_id,
          session_id,
          type,
          reason,
          amount,
          note,
          created_at,
          created_by
        from public.cash_movements
        where tenant_id::text = ${String(tenantId)}::text
          and branch_id::text = ${String(branchId)}::text
          and session_id::text = ${String(open.id)}::text
        order by created_at desc
        limit ${limit}
      `;

      return res.json({
        branchId,
        sessionId: open.id,
        movements: (rows || []).map(toCashMovementDto),
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/cash-drawer/open
router.post(
  "/open",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_OPEN),
  async (req, res, next) => {
    try {
      const user = req.user;
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;

      const branchCheck = await assertBranchIsOperable(tenantId, branchId);
      if (!branchCheck.ok) {
        return res.status(branchCheck.status).json(branchCheck.body);
      }

      const existing = await getOpenSession(tenantId, branchId);

      if (existing) {
        return res.status(409).json({
          message: "Drawer already open for this branch",
          code: "CASH_DRAWER_ALREADY_OPEN",
          branchId,
          session: toCashSessionDto(existing),
        });
      }

      const openingCash = toBigIntAmount(
        req.body?.openingCash ?? req.body?.openingBalance ?? 0,
      );

      if (openingCash == null) {
        return res.status(400).json({
          message: "Invalid openingCash",
          code: "INVALID_OPENING_CASH",
        });
      }

      const rows = await prisma.$queryRaw`
        insert into public.cash_sessions
          (tenant_id, branch_id, opened_by, opening_cash)
        values
          (
            ${String(tenantId)}::uuid,
            ${String(branchId)}::text,
            ${String(user.id)}::uuid,
            ${openingCash}
          )
        returning
          id,
          tenant_id,
          branch_id,
          opened_at,
          opened_by,
          opening_cash,
          closed_at,
          closed_by,
          counted_cash,
          close_note,
          created_at
      `;

      const session = rows?.[0];

      return res.json({
        session: toCashSessionDto(session),
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/cash-drawer/close
router.post(
  "/close",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_CLOSE),
  async (req, res, next) => {
    try {
      const user = req.user;
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;

      const open = await getOpenSession(tenantId, branchId);

      if (!open) {
        return res.status(409).json({
          message: "Drawer is not open for this branch",
          code: "CASH_DRAWER_NOT_OPEN",
          branchId,
        });
      }

      const countedCash = toBigIntAmount(
        req.body?.countedCash ?? req.body?.closingCash ?? req.body?.closingBalance,
      );

      if (countedCash == null) {
        return res.status(400).json({
          message: "Invalid countedCash/closingCash",
          code: "INVALID_COUNTED_CASH",
        });
      }

      const closeNote = String(req.body?.note || "").trim() || null;

      const rows = await prisma.$queryRaw`
        update public.cash_sessions
        set
          closed_at = now(),
          closed_by = ${String(user.id)}::uuid,
          counted_cash = ${countedCash},
          close_note = ${closeNote}
        where id::text = ${String(open.id)}::text
          and tenant_id::text = ${String(tenantId)}::text
          and branch_id::text = ${String(branchId)}::text
          and closed_at is null
        returning
          id,
          tenant_id,
          branch_id,
          opened_at,
          opened_by,
          opening_cash,
          closed_at,
          closed_by,
          counted_cash,
          close_note,
          created_at
      `;

      const session = rows?.[0];

      if (!session) {
        return res.status(409).json({
          message: "Drawer could not be closed because it is no longer open",
          code: "CASH_DRAWER_CLOSE_CONFLICT",
          branchId,
        });
      }

      return res.json({
        session: toCashSessionDto(session),
      });
    } catch (e) {
      next(e);
    }
  },
);

// POST /api/cash-drawer/movements
router.post(
  "/movements",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_RECORD_MOVEMENT),
  async (req, res, next) => {
    try {
      const user = req.user;
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;

      const branchCheck = await assertBranchIsOperable(tenantId, branchId);
      if (!branchCheck.ok) {
        return res.status(branchCheck.status).json(branchCheck.body);
      }

      const open = await getOpenSession(tenantId, branchId);

      if (!open) {
        return res.status(409).json({
          message: "Drawer is not open for this branch",
          code: "CASH_DRAWER_NOT_OPEN",
          branchId,
        });
      }

      const type = normalizeMovementType(req.body?.type);

      if (!type) {
        return res.status(400).json({
          message: "Invalid type (IN|OUT)",
          code: "INVALID_MOVEMENT_TYPE",
        });
      }

      const amount = toBigIntAmount(req.body?.amount);

      if (amount == null || amount <= 0n) {
        return res.status(400).json({
          message: "Invalid amount",
          code: "INVALID_MOVEMENT_AMOUNT",
        });
      }

      const note = String(req.body?.note || "").trim() || null;
      const reason = normalizeMovementReason(req.body?.reason, type);

      const rows = await prisma.$queryRaw`
        insert into public.cash_movements
          (tenant_id, branch_id, session_id, type, reason, amount, note, created_by)
        values
          (
            ${String(tenantId)}::uuid,
            ${String(branchId)}::text,
            ${String(open.id)}::uuid,
            ${type}::cash_movement_type,
            ${reason}::cash_movement_reason,
            ${amount},
            ${note},
            ${String(user.id)}::uuid
          )
        returning
          id,
          tenant_id,
          branch_id,
          session_id,
          type,
          reason,
          amount,
          note,
          created_at,
          created_by
      `;

      const movement = rows?.[0];

      return res.json({
        movement: toCashMovementDto(movement),
      });
    } catch (e) {
      next(e);
    }
  },
);

module.exports = router;