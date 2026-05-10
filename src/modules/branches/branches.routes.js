// backend/src/modules/branches/branches.routes.js
const express = require("express");

const authenticate = require("../../middlewares/authenticate");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const {
  requireWritableSubscription,
} = require("../../middlewares/requireActiveSubscription");
const { PERMISSIONS } = require("../auth/permissions");

const {
  getBranches,
  getBranchUsage,
  createBranch,
  updateBranch,
  setMainBranch,
  archiveBranch,
  reactivateBranch,
  assignStaffToBranch,
  removeStaffFromBranch,
} = require("./branches.controller");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  requireDbPermission(PERMISSIONS.BRANCHES_VIEW),
  getBranches
);

router.get(
  "/usage",
  requireDbPermission(PERMISSIONS.BRANCHES_VIEW),
  getBranchUsage
);

router.post(
  "/",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.BRANCHES_CREATE),
  createBranch
);

router.patch(
  "/:branchId",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.BRANCHES_EDIT),
  updateBranch
);

router.patch(
  "/:branchId/main",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.BRANCHES_EDIT),
  setMainBranch
);

router.patch(
  "/:branchId/archive",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.BRANCHES_ARCHIVE),
  archiveBranch
);

router.patch(
  "/:branchId/reactivate",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.BRANCHES_EDIT),
  reactivateBranch
);

router.post(
  "/:branchId/staff",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_EDIT),
  assignStaffToBranch
);

router.delete(
  "/:branchId/staff/:userId",
  requireWritableSubscription,
  requireDbPermission(PERMISSIONS.MEMBERS_EDIT),
  removeStaffFromBranch
);

module.exports = router;