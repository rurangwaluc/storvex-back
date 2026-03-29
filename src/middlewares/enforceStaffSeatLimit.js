// src/middlewares/enforceStaffSeatLimit.js
const prisma = require("../config/database");

const BILLABLE_ROLES = new Set([
  "OWNER",
  "MANAGER",
  "CASHIER",
  "SELLER",
  "STOREKEEPER",
  "TECHNICIAN",
]);

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeRole(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const v = String(value || "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return null;
}

function isBillableRole(role) {
  return BILLABLE_ROLES.has(normalizeRole(role));
}

function getTenantId(req) {
  return (
    cleanString(req.user?.tenantId) ||
    cleanString(req.tenantId) ||
    cleanString(req.params?.tenantId) ||
    cleanString(req.body?.tenantId) ||
    cleanString(req.query?.tenantId) ||
    null
  );
}

async function getSubscriptionOrThrow(tenantId) {
  const subscription = await prisma.subscription.findUnique({
    where: { tenantId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      accessMode: true,
      planKey: true,
      tierKey: true,
      cycleKey: true,
      staffLimit: true,
      priceAmount: true,
      currency: true,
      startDate: true,
      endDate: true,
      graceEndDate: true,
      readOnlySince: true,
      trialConsumed: true,
      trialStartDate: true,
      trialEndDate: true,
    },
  });

  if (!subscription) {
    const err = new Error("Subscription not found");
    err.status = 404;
    throw err;
  }

  return subscription;
}

async function countActiveBillableUsers(tenantId) {
  return prisma.user.count({
    where: {
      tenantId,
      isActive: true,
      role: {
        in: Array.from(BILLABLE_ROLES),
      },
    },
  });
}

function buildSeatLimitPayload({ subscription, activeStaff, requestedRole, requestedIsActive }) {
  const staffLimit = Number.isFinite(Number(subscription?.staffLimit))
    ? Number(subscription.staffLimit)
    : null;

  return {
    code: "STAFF_LIMIT_REACHED",
    message:
      "Your current plan has reached its active staff limit. Upgrade the subscription to add more active staff.",
    subscription: {
      planKey: subscription?.planKey || null,
      tierKey: subscription?.tierKey || null,
      cycleKey: subscription?.cycleKey || null,
      staffLimit,
      status: subscription?.status || null,
      accessMode: subscription?.accessMode || null,
      priceAmount: Number.isFinite(Number(subscription?.priceAmount))
        ? Number(subscription.priceAmount)
        : null,
      currency: subscription?.currency || null,
      endDate: subscription?.endDate || null,
      graceEndDate: subscription?.graceEndDate || null,
    },
    usage: {
      activeStaff,
      requestedRole: requestedRole || null,
      requestedIsActive: Boolean(requestedIsActive),
      nextActiveStaff: Number(activeStaff) + 1,
      overLimit: staffLimit != null ? Number(activeStaff) + 1 > Number(staffLimit) : false,
    },
  };
}

/**
 * Generic seat enforcement for CREATE member/staff routes.
 *
 * Assumptions:
 * - req.body.role holds the target role
 * - req.body.isActive may be omitted; omitted means true for new users
 * - OWNER/MANAGER/etc count as billable seats
 * - PLATFORM_ADMIN or unknown internal roles do not count
 */
async function enforceSeatLimitOnCreate(req, res, next) {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ message: "Missing tenant context" });
    }

    const requestedRole = normalizeRole(req.body?.role);
    const requestedIsActiveRaw = normalizeBoolean(req.body?.isActive);
    const requestedIsActive = requestedIsActiveRaw === null ? true : requestedIsActiveRaw;

    if (!isBillableRole(requestedRole)) {
      return next();
    }

    if (!requestedIsActive) {
      return next();
    }

    const subscription = await getSubscriptionOrThrow(tenantId);
    const staffLimit = Number.isFinite(Number(subscription.staffLimit))
      ? Number(subscription.staffLimit)
      : null;

    // Unlimited plans or missing limit do not block here.
    if (staffLimit === null) {
      req.seatUsage = {
        activeStaff: await countActiveBillableUsers(tenantId),
        staffLimit: null,
        unlimited: true,
      };
      return next();
    }

    const activeStaff = await countActiveBillableUsers(tenantId);

    if (Number(activeStaff) >= Number(staffLimit)) {
      return res.status(403).json(
        buildSeatLimitPayload({
          subscription,
          activeStaff,
          requestedRole,
          requestedIsActive,
        })
      );
    }

    req.seatUsage = {
      activeStaff,
      staffLimit,
      unlimited: false,
    };

    return next();
  } catch (err) {
    console.error("enforceSeatLimitOnCreate error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
}

/**
 * Seat enforcement for UPDATE / ACTIVATE member routes.
 *
 * Assumptions:
 * - req.params.id is the user being edited
 * - req.body.role and/or req.body.isActive may change
 * - if a non-billable inactive user becomes active billable, count must be checked
 * - if active billable remains active billable, no extra seat needed
 */
async function enforceSeatLimitOnUpdate(req, res, next) {
  try {
    const tenantId = getTenantId(req);
    const targetUserId =
      cleanString(req.params?.id) ||
      cleanString(req.params?.userId) ||
      cleanString(req.body?.userId);

    if (!tenantId) {
      return res.status(400).json({ message: "Missing tenant context" });
    }

    if (!targetUserId) {
      return res.status(400).json({ message: "Missing target user id" });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        tenantId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const nextRole = cleanString(req.body?.role)
      ? normalizeRole(req.body.role)
      : normalizeRole(existingUser.role);

    const nextIsActiveRaw = normalizeBoolean(req.body?.isActive);
    const nextIsActive =
      nextIsActiveRaw === null ? Boolean(existingUser.isActive) : nextIsActiveRaw;

    const wasBillableActive =
      Boolean(existingUser.isActive) && isBillableRole(existingUser.role);

    const willBeBillableActive = Boolean(nextIsActive) && isBillableRole(nextRole);

    // No new billable seat needed.
    if (!willBeBillableActive) {
      return next();
    }

    // Already occupying a billable active seat, so no extra seat needed.
    if (wasBillableActive) {
      return next();
    }

    const subscription = await getSubscriptionOrThrow(tenantId);
    const staffLimit = Number.isFinite(Number(subscription.staffLimit))
      ? Number(subscription.staffLimit)
      : null;

    if (staffLimit === null) {
      req.seatUsage = {
        activeStaff: await countActiveBillableUsers(tenantId),
        staffLimit: null,
        unlimited: true,
      };
      return next();
    }

    const activeStaff = await countActiveBillableUsers(tenantId);

    if (Number(activeStaff) >= Number(staffLimit)) {
      return res.status(403).json(
        buildSeatLimitPayload({
          subscription,
          activeStaff,
          requestedRole: nextRole,
          requestedIsActive: nextIsActive,
        })
      );
    }

    req.seatUsage = {
      activeStaff,
      staffLimit,
      unlimited: false,
    };

    return next();
  } catch (err) {
    console.error("enforceSeatLimitOnUpdate error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
}

/**
 * Utility helper for controller-level use when you need a direct check
 * before bulk actions or custom flows.
 */
async function assertSeatAvailableForTenant({
  tenantId,
  requestedRole,
  requestedIsActive = true,
}) {
  if (!tenantId) {
    const err = new Error("Missing tenantId");
    err.status = 400;
    throw err;
  }

  if (!isBillableRole(requestedRole) || !requestedIsActive) {
    return {
      ok: true,
      activeStaff: await countActiveBillableUsers(tenantId),
      staffLimit: null,
      unlimited: false,
    };
  }

  const subscription = await getSubscriptionOrThrow(tenantId);
  const staffLimit = Number.isFinite(Number(subscription.staffLimit))
    ? Number(subscription.staffLimit)
    : null;

  const activeStaff = await countActiveBillableUsers(tenantId);

  if (staffLimit === null) {
    return {
      ok: true,
      activeStaff,
      staffLimit: null,
      unlimited: true,
    };
  }

  if (Number(activeStaff) >= Number(staffLimit)) {
    const err = new Error(
      "Your current plan has reached its active staff limit. Upgrade the subscription to add more active staff."
    );
    err.status = 403;
    err.code = "STAFF_LIMIT_REACHED";
    err.meta = buildSeatLimitPayload({
      subscription,
      activeStaff,
      requestedRole,
      requestedIsActive,
    });
    throw err;
  }

  return {
    ok: true,
    activeStaff,
    staffLimit,
    unlimited: false,
  };
}

module.exports = {
  BILLABLE_ROLES,
  isBillableRole,
  countActiveBillableUsers,
  assertSeatAvailableForTenant,
  enforceSeatLimitOnCreate,
  enforceSeatLimitOnUpdate,
};