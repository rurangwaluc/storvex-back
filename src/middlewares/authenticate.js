const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

const ACCESSIBLE_BRANCH_STATUSES = ["ACTIVE", "CLOSED"];
const OPERABLE_BRANCH_STATUS = "ACTIVE";

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function normalizeBranchHeader(req) {
  return (
    cleanString(req.headers["x-branch-id"]) ||
    cleanString(req.headers["x_branch_id"]) ||
    cleanString(req.query?.branchId) ||
    cleanString(req.body?.branchId) ||
    null
  );
}

function normalizeRole(role) {
  return String(role || "").trim().toUpperCase();
}

function isOwner(role) {
  return normalizeRole(role) === "OWNER";
}

function isManager(role) {
  return normalizeRole(role) === "MANAGER";
}

function isDatabaseUnavailableError(err) {
  const msg = String(err?.message || "");
  return (
    err?.code === "P1001" ||
    msg.includes("Can't reach database server") ||
    msg.includes("Connection terminated") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT")
  );
}

function branchPublicShape(branch) {
  if (!branch) return null;

  return {
    id: branch.id,
    tenantId: branch.tenantId,
    name: branch.name,
    code: branch.code,
    type: branch.type,
    status: branch.status,
    isMain: Boolean(branch.isMain),
  };
}

async function touchSession(sessionId, previousLastSeenAt = null) {
  if (!sessionId) return;

  const previous = previousLastSeenAt ? new Date(previousLastSeenAt) : null;
  const now = new Date();

  if (previous && !Number.isNaN(previous.getTime())) {
    const ageMs = now.getTime() - previous.getTime();

    // Do not write on every request. One update every 5 minutes is enough.
    if (ageMs < 5 * 60 * 1000) return;
  }

  await prisma.userSession
    .update({
      where: { id: sessionId },
      data: {
        lastSeenAt: now,
      },
    })
    .catch(() => null);
}

module.exports = async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Missing token",
      code: "AUTH_TOKEN_MISSING",
    });
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error("JWT VERIFY ERROR:", err.message);
    return res.status(401).json({
      message: "Invalid or expired token",
      code: "AUTH_TOKEN_INVALID",
    });
  }

  const userId = decoded.userId || decoded.id || null;
  const tenantId = decoded.tenantId || null;
  const tokenId = decoded.tokenId || null;

  if (!userId || !tenantId) {
    return res.status(401).json({
      message: "Invalid token claims",
      code: "AUTH_TOKEN_CLAIMS_INVALID",
    });
  }

  try {
    const requestedBranchId = normalizeBranchHeader(req);

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
      },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        message: "User not found",
        code: "AUTH_USER_NOT_FOUND",
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        message: "Account is deactivated",
        code: "AUTH_USER_DEACTIVATED",
      });
    }

    let sessionId = null;

    if (tokenId) {
      const session = await prisma.userSession.findFirst({
        where: {
          tenantId,
          userId,
          tokenId,
        },
        select: {
          id: true,
          isRevoked: true,
          expiresAt: true,
          lastSeenAt: true,
        },
      });

      if (!session) {
        return res.status(401).json({
          message: "Session not found",
          code: "AUTH_SESSION_NOT_FOUND",
        });
      }

      if (session.isRevoked) {
        return res.status(401).json({
          message: "Session revoked",
          code: "AUTH_SESSION_REVOKED",
        });
      }

      if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
        return res.status(401).json({
          message: "Session expired",
          code: "AUTH_SESSION_EXPIRED",
        });
      }

      sessionId = session.id;
      await touchSession(session.id, session.lastSeenAt);
    }

    const role = normalizeRole(user.role);
    const owner = isOwner(role);
    const manager = isManager(role);

    /*
      Business rule:
      - OWNER can view all ACTIVE/CLOSED branches in the tenant.
      - MANAGER does not automatically view all branches.
      - Staff access remains assignment-driven.
      - ARCHIVED branches are not accessible through normal authenticated app flows.
    */
    const canViewAllBranches = owner;

    const [tenant, branchAssignments] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          mainBranchId: true,
        },
      }),
      prisma.userBranchAssignment.findMany({
        where: {
          tenantId,
          userId,
          branch: {
            tenantId,
            status: {
              in: ACCESSIBLE_BRANCH_STATUSES,
            },
          },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isDefault: true,
          canOperate: true,
          canViewReports: true,
          branch: {
            select: {
              id: true,
              tenantId: true,
              name: true,
              code: true,
              type: true,
              status: true,
              isMain: true,
            },
          },
        },
      }),
    ]);

    if (!tenant) {
      return res.status(401).json({
        message: "Tenant not found",
        code: "AUTH_TENANT_NOT_FOUND",
      });
    }

    const normalizedAssignments = (branchAssignments || [])
      .filter((row) => row?.branch?.id && row.branch.tenantId === tenantId)
      .map((row) => ({
        assignmentId: row.id,
        isDefault: Boolean(row.isDefault),
        canOperate: Boolean(row.canOperate),
        canViewReports: Boolean(row.canViewReports),
        branch: row.branch,
      }));

    const assignedBranchIds = normalizedAssignments.map((row) => row.branch.id);

    const defaultAssignment =
      normalizedAssignments.find((row) => row.isDefault) ||
      normalizedAssignments.find((row) => row.branch?.isMain) ||
      normalizedAssignments[0] ||
      null;

    let allowedBranchIds = assignedBranchIds.slice();
    let activeAssignment = null;
    let activeBranch = null;

    if (requestedBranchId) {
      activeAssignment =
        normalizedAssignments.find((row) => row.branch.id === requestedBranchId) || null;

      if (activeAssignment) {
        activeBranch = activeAssignment.branch;
      } else if (!canViewAllBranches) {
        return res.status(403).json({
          message: "Branch access denied",
          code: "BRANCH_ACCESS_DENIED",
          branchId: requestedBranchId,
        });
      } else {
        const branch = await prisma.branch.findFirst({
          where: {
            id: requestedBranchId,
            tenantId,
            status: {
              in: ACCESSIBLE_BRANCH_STATUSES,
            },
          },
          select: {
            id: true,
            tenantId: true,
            name: true,
            code: true,
            type: true,
            status: true,
            isMain: true,
          },
        });

        if (!branch) {
          return res.status(404).json({
            message: "Branch not found",
            code: "BRANCH_NOT_FOUND",
            branchId: requestedBranchId,
          });
        }

        activeBranch = branch;

        if (!allowedBranchIds.includes(branch.id)) {
          allowedBranchIds.push(branch.id);
        }
      }
    } else if (defaultAssignment) {
      activeAssignment = defaultAssignment;
      activeBranch = defaultAssignment.branch;
    } else if (owner && tenant.mainBranchId) {
      const mainBranch = await prisma.branch.findFirst({
        where: {
          id: tenant.mainBranchId,
          tenantId,
          status: {
            in: ACCESSIBLE_BRANCH_STATUSES,
          },
        },
        select: {
          id: true,
          tenantId: true,
          name: true,
          code: true,
          type: true,
          status: true,
          isMain: true,
        },
      });

      if (mainBranch) {
        activeBranch = mainBranch;

        if (!allowedBranchIds.includes(mainBranch.id)) {
          allowedBranchIds.push(mainBranch.id);
        }
      }
    } else {
      return res.status(403).json({
        message: "No branch assignment found for this user",
        code: "BRANCH_ASSIGNMENT_REQUIRED",
      });
    }

    if (!activeBranch && !owner) {
      return res.status(403).json({
        message: "No active branch could be resolved for this user",
        code: "BRANCH_REQUIRED",
      });
    }

    const activeBranchId = activeBranch?.id || tenant.mainBranchId || null;
    const defaultBranchId = defaultAssignment?.branch?.id || tenant.mainBranchId || null;

    const activeBranchIsOperable =
      activeBranch?.status === OPERABLE_BRANCH_STATUS;

    const canOperateInActiveBranch = activeAssignment
      ? Boolean(activeAssignment.canOperate) && activeBranchIsOperable
      : owner && activeBranchIsOperable;

    const canViewReportsInActiveBranch = activeAssignment
      ? Boolean(activeAssignment.canViewReports) || owner
      : owner;

    req.user = {
      id: user.id,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      normalizedRole: role,
      tokenId: tokenId || null,
      sessionId,
      platform: decoded.platform === true,

      defaultBranchId,
      branchId: activeBranchId,
      activeBranchId,
      requestedBranchId,
      allowedBranchIds,
      canViewAllBranches,
      canOperateInActiveBranch,
      canViewReportsInActiveBranch,

      isOwner: owner,
      isManager: manager,
    };

    req.branch = branchPublicShape(activeBranch);

    req.branchAccess = {
      requestedBranchId,
      defaultBranchId,
      activeBranchId,
      allowedBranchIds,
      canViewAllBranches,
      canOperateInActiveBranch,
      canViewReportsInActiveBranch,
      assignment: activeAssignment
        ? {
            assignmentId: activeAssignment.assignmentId,
            isDefault: activeAssignment.isDefault,
            canOperate: activeAssignment.canOperate,
            canViewReports: activeAssignment.canViewReports,
          }
        : null,
    };

    return next();
  } catch (err) {
    console.error("AUTH DATABASE ERROR:", err);

    if (isDatabaseUnavailableError(err)) {
      return res.status(503).json({
        message: "Authentication service temporarily unavailable",
        code: "AUTH_DB_UNAVAILABLE",
      });
    }

    return res.status(500).json({
      message: "Authentication failed",
      code: "AUTH_FAILED",
    });
  }
};