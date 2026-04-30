const express = require("express");
const authenticate = require("../../middlewares/authenticate");
const requireDbPermission = require("../../middlewares/requireDbPermission");
const { PERMISSIONS } = require("../auth/permissions");
const {
  getBranches,
  getBranchUsage,
  createBranch,
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
  requireDbPermission(PERMISSIONS.BRANCHES_CREATE),
  createBranch
);

module.exports = router;