// backend/src/modules/branches/branches.controller.js
const {
  getTenantBranchUsage,
  listBranches,
  createBranch,
  updateBranch,
  setMainBranch,
  archiveBranch,
  reactivateBranch,
  updateBranchStaff,
} = require("./branches.service");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

function getActor(req) {
  return {
    tenantId: req.user?.tenantId || null,
    actorUserId: req.user?.userId || req.user?.id || null,
    actorRole: req.user?.role || null,
  };
}

function unauthorized(res) {
  return res.status(401).json({ message: "Unauthorized" });
}

function sendError(res, err, fallbackMessage) {
  return res.status(err.status || 500).json({
    message: err.message || fallbackMessage,
    code: err.code || null,
    details: err.details || null,
  });
}

async function getBranches(req, res) {
  try {
    const { tenantId } = getActor(req);

    if (!tenantId) {
      return unauthorized(res);
    }

    const [branches, branchUsage] = await Promise.all([
      listBranches(tenantId),
      getTenantBranchUsage(tenantId),
    ]);

    return res.json({
      branches,
      usage: branchUsage.usage,
      subscription: branchUsage.subscription,
      tenant: branchUsage.tenant,
    });
  } catch (err) {
    console.error("getBranches error:", err);
    return sendError(res, err, "Failed to load store locations");
  }
}

async function getBranchUsage(req, res) {
  try {
    const { tenantId } = getActor(req);

    if (!tenantId) {
      return unauthorized(res);
    }

    const result = await getTenantBranchUsage(tenantId);

    return res.json(result);
  } catch (err) {
    console.error("getBranchUsage error:", err);
    return sendError(res, err, "Failed to load location usage");
  }
}

async function createBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    const {
      name,
      code,
      phone,
      email,
      countryCode,
      district,
      sector,
      address,
    } = req.body || {};

    if (!cleanString(name)) {
      return res.status(400).json({ message: "Location name is required" });
    }

    if (!cleanString(code)) {
      return res.status(400).json({ message: "Location code is required" });
    }

    const result = await createBranch({
      tenantId,
      actorUserId,
      actorRole,
      name,
      code,
      phone,
      email,
      countryCode,
      district,
      sector,
      address,
    });

    return res.status(201).json({
      message: "Store location created successfully",
      ...result,
    });
  } catch (err) {
    console.error("createBranchHandler error:", err);
    return sendError(res, err, "Failed to create store location");
  }
}

async function updateBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    const result = await updateBranch({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
      ...req.body,
    });

    return res.json({
      message: "Store location updated successfully",
      ...result,
    });
  } catch (err) {
    console.error("updateBranchHandler error:", err);
    return sendError(res, err, "Failed to update store location");
  }
}

async function setMainBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    const result = await setMainBranch({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
    });

    return res.json({
      message: "Main store location updated successfully",
      ...result,
    });
  } catch (err) {
    console.error("setMainBranchHandler error:", err);
    return sendError(res, err, "Failed to set main store location");
  }
}

async function archiveBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    const result = await archiveBranch({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
    });

    return res.json({
      message: "Store location archived successfully",
      ...result,
    });
  } catch (err) {
    console.error("archiveBranchHandler error:", err);
    return sendError(res, err, "Failed to archive store location");
  }
}

async function reactivateBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    const result = await reactivateBranch({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
    });

    return res.json({
      message: "Store location reactivated successfully",
      ...result,
    });
  } catch (err) {
    console.error("reactivateBranchHandler error:", err);
    return sendError(res, err, "Failed to reactivate store location");
  }
}

async function assignStaffToBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);
    const staffUserId = cleanString(req.body?.userId || req.body?.staffUserId);

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    if (!staffUserId) {
      return res.status(400).json({ message: "Staff member is required" });
    }

    const result = await updateBranchStaff({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
      assignments: [
        {
          userId: staffUserId,
          isDefault: Boolean(req.body?.isDefault),
          canOperate:
            typeof req.body?.canOperate === "boolean" ? req.body.canOperate : true,
          canViewReports:
            typeof req.body?.canViewReports === "boolean"
              ? req.body.canViewReports
              : false,
        },
      ],
    });

    return res.json({
      message: "Staff access updated successfully",
      assignments: result,
    });
  } catch (err) {
    console.error("assignStaffToBranchHandler error:", err);
    return sendError(res, err, "Failed to update staff location access");
  }
}

async function removeStaffFromBranchHandler(req, res) {
  try {
    const { tenantId, actorUserId, actorRole } = getActor(req);
    const branchId = cleanString(req.params.branchId || req.params.id);
    const staffUserId = cleanString(
      req.params.userId ||
        req.params.staffUserId ||
        req.body?.userId ||
        req.body?.staffUserId,
    );

    if (!tenantId || !actorUserId || !actorRole) {
      return unauthorized(res);
    }

    if (!branchId) {
      return res.status(400).json({ message: "Location is required" });
    }

    if (!staffUserId) {
      return res.status(400).json({ message: "Staff member is required" });
    }

    const result = await updateBranchStaff({
      tenantId,
      actorUserId,
      actorRole,
      branchId,
      assignments: [],
    });

    return res.json({
      message: "Staff access removed successfully",
      assignments: result,
    });
  } catch (err) {
    console.error("removeStaffFromBranchHandler error:", err);
    return sendError(res, err, "Failed to remove staff location access");
  }
}

module.exports = {
  getBranches,
  getBranchUsage,
  createBranch: createBranchHandler,
  updateBranch: updateBranchHandler,
  setMainBranch: setMainBranchHandler,
  archiveBranch: archiveBranchHandler,
  reactivateBranch: reactivateBranchHandler,
  assignStaffToBranch: assignStaffToBranchHandler,
  removeStaffFromBranch: removeStaffFromBranchHandler,
};