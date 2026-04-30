const {
  getTenantBranchUsage,
  listBranches,
  createBranch,
} = require("./branches.service");

function cleanString(value) {
  const s = String(value || "").trim();
  return s || null;
}

async function getBranches(req, res) {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
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
    return res.status(err.status || 500).json({
      message: err.message || "Failed to load branches",
      code: err.code || null,
      details: err.details || null,
    });
  }
}

async function getBranchUsage(req, res) {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getTenantBranchUsage(tenantId);

    return res.json(result);
  } catch (err) {
    console.error("getBranchUsage error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to load branch usage",
      code: err.code || null,
      details: err.details || null,
    });
  }
}

async function createBranchHandler(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const actorUserId = req.user?.userId || req.user?.id;
    const actorRole = req.user?.role;

    if (!tenantId || !actorUserId || !actorRole) {
      return res.status(401).json({ message: "Unauthorized" });
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
      return res.status(400).json({ message: "Branch name is required" });
    }

    if (!cleanString(code)) {
      return res.status(400).json({ message: "Branch code is required" });
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
      message: "Branch created successfully",
      ...result,
    });
  } catch (err) {
    console.error("createBranchHandler error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to create branch",
      code: err.code || null,
      details: err.details || null,
    });
  }
}

module.exports = {
  getBranches,
  getBranchUsage,
  createBranch: createBranchHandler,
};