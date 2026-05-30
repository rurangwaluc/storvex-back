const express = require("express");
const prisma = require("../../config/database");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");

const router = express.Router();

const BUSINESS_TIMEZONE = "Africa/Kigali";

const OPENING_REASONS = new Set([
  "NORMAL_FLOAT",
  "OWNER_ADDED_STARTING_CASH",
  "CASH_LEFT_FROM_PREVIOUS_DAY",
  "CHANGE_MONEY_PREPARED",
  "CORRECTION_FROM_PREVIOUS_DRAWER",
  "OTHER_OPENING_REASON",
]);

const CASH_SHORT_REASONS = new Set([
  "CUSTOMER_PAID_LESS_CASH",
  "CHANGE_SHORTAGE",
  "CASH_REMOVED_NOT_RECORDED",
  "EXPENSE_PAID_NOT_RECORDED",
  "COUNTING_MISTAKE",
  "OTHER_SHORT_CASH_REASON",
]);

const CASH_OVER_REASONS = new Set([
  "CUSTOMER_PAID_EXTRA_CASH",
  "CASH_SALE_NOT_RECORDED",
  "CASH_ADDED_NOT_RECORDED",
  "CHANGE_NOT_GIVEN",
  "COUNTING_MISTAKE",
  "OTHER_OVER_CASH_REASON",
]);

// -------- utils --------

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function toBigIntAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return BigInt(Math.round(n));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringAmount(value) {
  return String(value ?? 0);
}

function normalizeMovementType(x) {
  const v = String(x || "").toUpperCase();
  if (v === "IN" || v === "OUT") return v;
  return null;
}

function normalizeMovementReason(x, type) {
  const v = String(x || "").toUpperCase().trim();
  const allowed = new Set(["FLOAT", "WITHDRAWAL", "DEPOSIT", "EXPENSE", "OTHER"]);

  if (allowed.has(v)) return v;

  if (type === "IN") return "DEPOSIT";
  if (type === "OUT") return "WITHDRAWAL";

  return "OTHER";
}

function normalizeOpeningReason(value) {
  const v = String(value || "").trim().toUpperCase();
  if (OPENING_REASONS.has(v)) return v;
  return null;
}

function normalizeClosingReason(value, difference) {
  const v = String(value || "").trim().toUpperCase();

  if (difference < 0 && CASH_SHORT_REASONS.has(v)) return v;
  if (difference > 0 && CASH_OVER_REASONS.has(v)) return v;
  if (difference === 0) return null;

  return null;
}

function isOwnerLikeUser(user = {}) {
  const roleValues = [
    user.role,
    user.roleName,
    user.type,
    user.accountType,
    user.responsibility,
    user.primaryRole,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toUpperCase());

  const permissionValues = [
    ...(Array.isArray(user.permissions) ? user.permissions : []),
    ...(Array.isArray(user.permissionKeys) ? user.permissionKeys : []),
  ].map((value) => String(value).trim().toUpperCase());

  return (
    roleValues.some((value) =>
      ["OWNER", "TENANT_OWNER", "BUSINESS_OWNER", "CO_OWNER", "PARTNER", "SUPER_OWNER"].includes(
        value,
      ),
    ) ||
    permissionValues.includes("CASH_DRAWER_REOPEN_SAME_DAY") ||
    permissionValues.includes("OWNER_ACCESS")
  );
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

function cashDifferenceTone(difference) {
  const n = toNumber(difference, 0);
  if (n < 0) return "SHORT";
  if (n > 0) return "OVER";
  return "EXACT";
}

function toCashSessionDto(session) {
  if (!session) return null;

  const expectedCash =
    session.expected_cash_at_close != null
      ? session.expected_cash_at_close
      : session.expected_cash != null
        ? session.expected_cash
        : 0;

  const countedCash = session.counted_cash != null ? session.counted_cash : null;
  const difference =
    session.cash_difference != null
      ? session.cash_difference
      : countedCash != null
        ? BigInt(String(countedCash)) - BigInt(String(expectedCash || 0))
        : null;

  return {
    id: session.id,
    tenantId: session.tenant_id,
    branchId: session.branch_id,

    openedAt: session.opened_at,
    openedBy: session.opened_by,
    openingCash: toStringAmount(session.opening_cash),
    openingReason: session.opening_reason ?? null,
    openingNote: session.opening_note ?? null,

    closedAt: session.closed_at ?? null,
    closedBy: session.closed_by ?? null,
    countedCash: countedCash != null ? toStringAmount(countedCash) : null,
    closeNote: session.close_note ?? null,
    closingReason: session.closing_reason ?? null,
    closingExplanation: session.closing_explanation ?? null,

    expectedCash: toStringAmount(expectedCash),
    cashDifference: difference != null ? toStringAmount(difference) : null,
    cashDifferenceAbs: difference != null ? toStringAmount(BigInt(String(difference)) < 0n ? -BigInt(String(difference)) : BigInt(String(difference))) : null,
    cashDifferenceTone: difference != null ? cashDifferenceTone(difference) : null,

    totalIn: toStringAmount(session.total_in ?? 0),
    totalOut: toStringAmount(session.total_out ?? 0),
    movementCount: Number(session.movement_count ?? 0),

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
    amount: toStringAmount(movement.amount),
    note: movement.note ?? null,
    createdAt: movement.created_at,
    createdBy: movement.created_by,
  };
}

// -------- db helpers --------

async function getOpenSession(tenantId, branchId) {
  const rows = await prisma.$queryRaw`
    select
      cs.id,
      cs.tenant_id,
      cs.branch_id,
      cs.opened_by,
      cs.opened_at,
      cs.opening_cash,
      cs.opening_reason,
      cs.opening_note,
      cs.closed_by,
      cs.closed_at,
      cs.counted_cash,
      cs.close_note,
      cs.closing_reason,
      cs.closing_explanation,
      cs.expected_cash_at_close,
      cs.cash_difference,
      cs.created_at,
      coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0) as total_in,
      coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0) as total_out,
      count(cm.id) as movement_count,
      (
        cs.opening_cash
        + coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0)
        - coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0)
      ) as expected_cash
    from public.cash_sessions cs
    left join public.cash_movements cm
      on cm.session_id = cs.id
      and cm.tenant_id = cs.tenant_id
      and cm.branch_id = cs.branch_id
    where cs.tenant_id::text = ${String(tenantId)}::text
      and cs.branch_id::text = ${String(branchId)}::text
      and cs.closed_at is null
    group by cs.id
    order by cs.opened_at desc
    limit 1
  `;

  return rows?.[0] || null;
}

async function getLatestSession(tenantId, branchId) {
  const rows = await prisma.$queryRaw`
    select
      cs.id,
      cs.tenant_id,
      cs.branch_id,
      cs.opened_by,
      cs.opened_at,
      cs.opening_cash,
      cs.opening_reason,
      cs.opening_note,
      cs.closed_by,
      cs.closed_at,
      cs.counted_cash,
      cs.close_note,
      cs.closing_reason,
      cs.closing_explanation,
      cs.expected_cash_at_close,
      cs.cash_difference,
      cs.created_at,
      coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0) as total_in,
      coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0) as total_out,
      count(cm.id) as movement_count,
      (
        cs.opening_cash
        + coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0)
        - coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0)
      ) as expected_cash
    from public.cash_sessions cs
    left join public.cash_movements cm
      on cm.session_id = cs.id
      and cm.tenant_id = cs.tenant_id
      and cm.branch_id = cs.branch_id
    where cs.tenant_id::text = ${String(tenantId)}::text
      and cs.branch_id::text = ${String(branchId)}::text
    group by cs.id
    order by cs.opened_at desc
    limit 1
  `;

  return rows?.[0] || null;
}

async function getSessionById(tenantId, branchId, sessionId) {
  const rows = await prisma.$queryRaw`
    select
      cs.id,
      cs.tenant_id,
      cs.branch_id,
      cs.opened_by,
      cs.opened_at,
      cs.opening_cash,
      cs.opening_reason,
      cs.opening_note,
      cs.closed_by,
      cs.closed_at,
      cs.counted_cash,
      cs.close_note,
      cs.closing_reason,
      cs.closing_explanation,
      cs.expected_cash_at_close,
      cs.cash_difference,
      cs.created_at,
      coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0) as total_in,
      coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0) as total_out,
      count(cm.id) as movement_count,
      (
        cs.opening_cash
        + coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0)
        - coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0)
      ) as expected_cash
    from public.cash_sessions cs
    left join public.cash_movements cm
      on cm.session_id = cs.id
      and cm.tenant_id = cs.tenant_id
      and cm.branch_id = cs.branch_id
    where cs.tenant_id::text = ${String(tenantId)}::text
      and cs.branch_id::text = ${String(branchId)}::text
      and cs.id::text = ${String(sessionId)}::text
    group by cs.id
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

async function wasClosedToday(session) {
  if (!session?.closed_at) return false;

  const rows = await prisma.$queryRaw`
    select
      (
        date(${session.closed_at}::timestamptz at time zone ${BUSINESS_TIMEZONE})
        =
        date(now() at time zone ${BUSINESS_TIMEZONE})
      ) as same_business_day
  `;

  return Boolean(rows?.[0]?.same_business_day);
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

      const [settings, open, branch, latest] = await Promise.all([
        getTenantDrawerSettings(tenantId),
        getOpenSession(tenantId, branchId),
        getBranchSummary(tenantId, branchId),
        getLatestSession(tenantId, branchId),
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
        latestSession: toCashSessionDto(latest),
        canReopenSameDay: isOwnerLikeUser(req.user),
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/cash-drawer/sessions?limit=20
router.get(
  "/sessions",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_VIEW),
  async (req, res, next) => {
    try {
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));

      const rows = await prisma.$queryRaw`
        select
          cs.id,
          cs.tenant_id,
          cs.branch_id,
          cs.opened_by,
          cs.opened_at,
          cs.opening_cash,
          cs.opening_reason,
          cs.opening_note,
          cs.closed_by,
          cs.closed_at,
          cs.counted_cash,
          cs.close_note,
          cs.closing_reason,
          cs.closing_explanation,
          cs.expected_cash_at_close,
          cs.cash_difference,
          cs.created_at,
          coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0) as total_in,
          coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0) as total_out,
          count(cm.id) as movement_count,
          (
            cs.opening_cash
            + coalesce(sum(case when cm.type = 'IN' then cm.amount else 0 end), 0)
            - coalesce(sum(case when cm.type = 'OUT' then cm.amount else 0 end), 0)
          ) as expected_cash
        from public.cash_sessions cs
        left join public.cash_movements cm
          on cm.session_id = cs.id
          and cm.tenant_id = cs.tenant_id
          and cm.branch_id = cs.branch_id
        where cs.tenant_id::text = ${String(tenantId)}::text
          and cs.branch_id::text = ${String(branchId)}::text
        group by cs.id
        order by cs.opened_at desc
        limit ${limit}
      `;

      return res.json({
        branchId,
        sessions: (rows || []).map(toCashSessionDto),
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/cash-drawer/sessions/:sessionId
router.get(
  "/sessions/:sessionId",
  requireDbPermission(PERMISSIONS.CASH_DRAWER_VIEW),
  async (req, res, next) => {
    try {
      const context = ensureBranchContext(req, res);
      if (!context) return;

      const { tenantId, branchId } = context;
      const sessionId = cleanString(req.params.sessionId);

      const session = await getSessionById(tenantId, branchId, sessionId);

      if (!session) {
        return res.status(404).json({
          message: "Cash drawer session not found",
          code: "CASH_DRAWER_SESSION_NOT_FOUND",
        });
      }

      const movements = await prisma.$queryRaw`
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
          and session_id::text = ${String(sessionId)}::text
        order by created_at desc
        limit 200
      `;

      return res.json({
        session: toCashSessionDto(session),
        movements: (movements || []).map(toCashMovementDto),
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

      const latest = await getLatestSession(tenantId, branchId);
      const latestClosedToday = await wasClosedToday(latest);

      if (latestClosedToday && !isOwnerLikeUser(user)) {
        return res.status(403).json({
          message: "This drawer was already closed today. Only the owner can reopen it before a new business day.",
          code: "CASH_DRAWER_OWNER_REOPEN_REQUIRED",
          branchId,
          latestSession: toCashSessionDto(latest),
        });
      }

      const openingCash = toBigIntAmount(
        req.body?.openingCash ?? req.body?.openingBalance ?? req.body?.openingAmount ?? 0,
      );

      if (openingCash == null) {
        return res.status(400).json({
          message: "Invalid openingCash",
          code: "INVALID_OPENING_CASH",
        });
      }

      const openingReason = normalizeOpeningReason(req.body?.openingReason || req.body?.reason);

      if (!openingReason) {
        return res.status(400).json({
          message: "Choose why the drawer is starting with this cash.",
          code: "OPENING_REASON_REQUIRED",
          allowedReasons: Array.from(OPENING_REASONS),
        });
      }

      const openingNote = cleanString(req.body?.openingNote || req.body?.note);

      const rows = await prisma.$queryRaw`
        insert into public.cash_sessions
          (tenant_id, branch_id, opened_by, opening_cash, opening_reason, opening_note)
        values
          (
            ${String(tenantId)}::uuid,
            ${String(branchId)}::text,
            ${String(user.id)}::uuid,
            ${openingCash},
            ${openingReason},
            ${openingNote}
          )
        returning
          id,
          tenant_id,
          branch_id,
          opened_at,
          opened_by,
          opening_cash,
          opening_reason,
          opening_note,
          closed_at,
          closed_by,
          counted_cash,
          close_note,
          closing_reason,
          closing_explanation,
          expected_cash_at_close,
          cash_difference,
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

      const expectedCash = BigInt(String(open.expected_cash ?? 0));
      const cashDifference = countedCash - expectedCash;
      const cashDifferenceNumber = Number(cashDifference);

      const closingReason = normalizeClosingReason(
        req.body?.closingReason || req.body?.differenceReason || req.body?.reason,
        cashDifferenceNumber,
      );

      const closingExplanation = cleanString(
        req.body?.closingExplanation || req.body?.differenceExplanation || req.body?.note,
      );

      if (cashDifference !== 0n && !closingReason) {
        return res.status(400).json({
          message:
            cashDifference < 0n
              ? "Choose why counted cash is below expected cash."
              : "Choose why counted cash is above expected cash.",
          code: cashDifference < 0n ? "SHORT_CASH_REASON_REQUIRED" : "OVER_CASH_REASON_REQUIRED",
          allowedReasons:
            cashDifference < 0n ? Array.from(CASH_SHORT_REASONS) : Array.from(CASH_OVER_REASONS),
        });
      }

      if (cashDifference !== 0n && !closingExplanation) {
        return res.status(400).json({
          message: "Explain the cash difference before closing the drawer.",
          code: "CASH_DIFFERENCE_EXPLANATION_REQUIRED",
        });
      }

      const closeNote = cleanString(req.body?.closeNote || req.body?.note);

      const rows = await prisma.$queryRaw`
        update public.cash_sessions
        set
          closed_at = now(),
          closed_by = ${String(user.id)}::uuid,
          counted_cash = ${countedCash},
          close_note = ${closeNote},
          closing_reason = ${closingReason},
          closing_explanation = ${closingExplanation},
          expected_cash_at_close = ${expectedCash},
          cash_difference = ${cashDifference}
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
          opening_reason,
          opening_note,
          closed_at,
          closed_by,
          counted_cash,
          close_note,
          closing_reason,
          closing_explanation,
          expected_cash_at_close,
          cash_difference,
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

      const note = cleanString(req.body?.note);
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