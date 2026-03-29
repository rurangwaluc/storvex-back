// src/modules/store/store.controller.js
const {
  getStoreProfile,
  getSetupChecklist,
  updateStoreProfile,
  getDocumentSettings,
  updateDocumentSettings,
  createLogoUploadContract,
} = require("./store.service");

const prisma = require("../../config/database");

// GET /api/store/profile
async function getProfile(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const profile = await getStoreProfile(tenantId);

    if (!profile) {
      return res.status(404).json({ message: "Store profile not found" });
    }

    return res.json({ profile });
  } catch (err) {
    console.error("getProfile error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to fetch store profile",
    });
  }
}

// PATCH /api/store/profile
async function patchProfile(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const profile = await updateStoreProfile(tenantId, req.body || {});

    return res.json({
      message: "Store profile updated",
      profile,
    });
  } catch (err) {
    console.error("patchProfile error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to update store profile",
    });
  }
}

// GET /api/store/setup-checklist
async function getChecklist(req, res) {
  try {
    const tenantId = req.user?.tenantId;

    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        id: true,
        accessMode: true,
        status: true,
        endDate: true,
        trialEndDate: true,
        graceEndDate: true,
      },
    });

    const checklist = await getSetupChecklist(tenantId, subscription);

    if (!checklist) {
      return res.status(404).json({ message: "Store setup checklist not found" });
    }

    // Only expose electronics roles to frontend
    const counts = checklist.counts || {};
    const filteredCounts = {
      activeOwners: counts.activeOwners || 0,
      activeManagers: counts.activeManagers || 0,
      activeStorekeepers: counts.activeStorekeepers || 0,
      activeSellers: counts.activeSellers || 0,
      activeCashiers: counts.activeCashiers || 0,
      activeTechnicians: counts.activeTechnicians || 0,
      activeKnownStoreUsers: counts.activeKnownStoreUsers || 0,
      activeProducts: counts.activeProducts || 0,
      totalStockUnits: counts.totalStockUnits || 0,
    };

    return res.json({
      tenantId: checklist.tenantId,
      isOperationallyReady: checklist.isOperationallyReady,
      onboardingCompleted: checklist.onboardingCompleted,
      onboardingCompletedAt: checklist.onboardingCompletedAt,
      readinessPercent: checklist.readinessPercent,
      counts: filteredCounts,
      checks: checklist.checks,
      summary: checklist.summary,
      trialBanner: checklist.trialBanner,
    });
  } catch (err) {
    console.error("getChecklist error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to fetch setup checklist",
    });
  }
}

// GET /api/store/document-settings
async function getDocumentConfig(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const config = await getDocumentSettings(tenantId);
    return res.json({ documentSettings: config });
  } catch (err) {
    console.error("getDocumentConfig error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to fetch document settings",
    });
  }
}

// PATCH /api/store/document-settings
async function patchDocumentConfig(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const config = await updateDocumentSettings(tenantId, req.body || {});
    return res.json({
      message: "Document settings updated",
      documentSettings: config,
    });
  } catch (err) {
    console.error("patchDocumentConfig error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to update document settings",
    });
  }
}

// POST /api/store/logo-upload-url
async function createLogoUploadUrl(req, res) {
  try {
    const tenantId = req.user?.tenantId;
    const contract = await createLogoUploadContract(tenantId, req.body || {});
    return res.status(201).json({
      message: "Logo upload URL created",
      upload: contract,
    });
  } catch (err) {
    console.error("createLogoUploadUrl error:", err);
    return res.status(err.status || 500).json({
      message: err.message || "Failed to create logo upload URL",
    });
  }
}

module.exports = {
  getProfile,
  patchProfile,
  getChecklist,
  getDocumentConfig,
  patchDocumentConfig,
  createLogoUploadUrl,
};