const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../../config/database");

const {
  getPlanByKey,
  getPlanSnapshot,
  getTrialPlan,
  getTrialDays,
} = require("../../config/plans");

const JWT_SECRET = process.env.JWT_SECRET;

function normalizeEmail(x) {
  const s = String(x || "").trim().toLowerCase();
  return s || null;
}

function normalizePhone(x) {
  const raw = String(x || "").trim().replace(/[^\d]/g, "");
  if (!raw) return null;
  if (raw.startsWith("07") && raw.length === 10) return `250${raw.slice(1)}`;
  return raw;
}

function isRwandaMsisdn250(phone) {
  return /^2507\d{8}$/.test(String(phone || ""));
}

function cleanString(x) {
  const s = String(x || "").trim();
  return s || null;
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.ip ? String(req.ip) : null;
}

function getUserAgent(req) {
  return req.headers["user-agent"] ? String(req.headers["user-agent"]) : null;
}

function parseUserAgent(ua) {
  const text = String(ua || "");
  const value = lower(text);

  if (!text) return "Unknown device";

  const isExpo = value.includes("expo");
  const isChrome = value.includes("chrome") || value.includes("crios");
  const isSafari = value.includes("safari") && !isChrome;
  const isFirefox = value.includes("firefox");
  const isEdge = value.includes("edg/");
  const isSamsung = value.includes("samsungbrowser");

  let device = "Unknown device";

  if (value.includes("cros")) device = "Chromebook";
  else if (value.includes("iphone")) device = "iPhone";
  else if (value.includes("ipad")) device = "iPad";
  else if (value.includes("android")) device = "Android device";
  else if (value.includes("windows")) device = "Windows device";
  else if (value.includes("macintosh") || value.includes("mac os")) device = "Mac device";
  else if (value.includes("linux")) device = "Linux device";

  let app = null;

  if (isExpo) app = "Storvex mobile";
  else if (isSamsung) app = "Samsung Internet";
  else if (isEdge) app = "Microsoft Edge";
  else if (isChrome) app = "Chrome";
  else if (isFirefox) app = "Firefox";
  else if (isSafari) app = "Safari";

  return app ? `${device} · ${app}` : device;
}

function passwordProblems(value) {
  const password = String(value || "");
  const problems = [];

  if (password.length < 8) problems.push("Use at least 8 characters.");
  if (!/[a-z]/.test(password)) problems.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(password)) problems.push("Add an uppercase letter.");
  if (!/[0-9]/.test(password)) problems.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(password)) problems.push("Add a symbol.");

  return problems;
}

async function recordLoginEventSafe(req, {
  tenantId,
  userId = null,
  email = null,
  role = null,
  status,
  method = "PASSWORD",
  reason = null,
}) {
  if (!tenantId || !status) return;

  await prisma.loginEvent
    .create({
      data: {
        tenantId,
        userId,
        email: normalizeEmail(email) || null,
        role: role || null,
        status,
        method,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        deviceLabel: parseUserAgent(getUserAgent(req)),
        reason,
      },
    })
    .catch(() => null);
}

function assertJwtSecret() {
  if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function fieldExists(model, fieldName) {
  return typeof model?.fields?.[fieldName] !== "undefined";
}

function getBranchLimitFromPlan(plan, signupMode = "PAID") {
  const raw = plan?.branchLimit;

  if (Number.isFinite(Number(raw)) && Number(raw) > 0) {
    return Number(raw);
  }

  if (String(signupMode || "").toUpperCase() === "TRIAL") {
    return 1;
  }

  return 1;
}

function makeMainBranchCode(storeName) {
  const cleaned = String(storeName || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim();

  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    const initials = parts
      .slice(0, 3)
      .map((p) => p[0])
      .join("");

    if (initials) return `${initials}_MAIN`;
  }

  if (parts.length === 1 && parts[0]) {
    const base = parts[0].slice(0, 6);
    return `${base}_MAIN`;
  }

  return "MAIN";
}

function makeMainBranchName(storeName) {
  const name = cleanString(storeName);
  if (!name) return "Main Branch";

  const lowerName = name.toLowerCase();
  if (lowerName.includes("main branch")) return name;

  return `${name} Main Branch`;
}

function snapshotPlanOrNull(plan) {
  if (!plan) return null;

  return {
    planKey: plan.key || null,
    tierKey: plan.tierKey || null,
    cycleKey: plan.cycleKey || null,
    staffLimit: Number.isFinite(Number(plan.staffLimit)) ? Number(plan.staffLimit) : null,
    branchLimit: getBranchLimitFromPlan(plan),
    priceAmount: Number.isFinite(Number(plan.price)) ? Number(plan.price) : null,
    requestedPriceAmount: Number.isFinite(Number(plan.price)) ? Number(plan.price) : null,
    currency: plan.currency || null,
    requestedCurrency: plan.currency || null,
  };
}

function createForbiddenTrialError(reason = "Free trial already used. Please choose a paid plan.") {
  const err = new Error(reason);
  err.status = 403;
  return err;
}

function buildTenantCreateData(intent, ownerEmail, ownerPhone) {
  const data = {
    name: String(intent.storeName || "").trim(),
    email: ownerEmail,
    phone: ownerPhone,
    status: "ACTIVE",
  };

  if (fieldExists(prisma.tenant, "shopType")) data.shopType = cleanString(intent.shopType);
  if (fieldExists(prisma.tenant, "district")) data.district = cleanString(intent.district);
  if (fieldExists(prisma.tenant, "sector")) data.sector = cleanString(intent.sector);
  if (fieldExists(prisma.tenant, "address")) data.address = cleanString(intent.address);
  if (fieldExists(prisma.tenant, "countryCode")) data.countryCode = "RW";
  if (fieldExists(prisma.tenant, "currencyCode")) data.currencyCode = "RWF";
  if (fieldExists(prisma.tenant, "timezone")) data.timezone = "Africa/Kigali";

  return data;
}

function buildTenantSelect() {
  return {
    id: true,
    name: true,
    email: true,
    phone: true,
    status: true,
    ...(fieldExists(prisma.tenant, "mainBranchId") ? { mainBranchId: true } : {}),
    ...(fieldExists(prisma.tenant, "shopType") ? { shopType: true } : {}),
    ...(fieldExists(prisma.tenant, "district") ? { district: true } : {}),
    ...(fieldExists(prisma.tenant, "sector") ? { sector: true } : {}),
    ...(fieldExists(prisma.tenant, "address") ? { address: true } : {}),
    ...(fieldExists(prisma.tenant, "countryCode") ? { countryCode: true } : {}),
    ...(fieldExists(prisma.tenant, "currencyCode") ? { currencyCode: true } : {}),
    ...(fieldExists(prisma.tenant, "timezone") ? { timezone: true } : {}),
    ...(fieldExists(prisma.tenant, "logoUrl") ? { logoUrl: true } : {}),
  };
}

function buildBranchPayload(branch) {
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

async function getWorkspaceContextForUser(userId, fallbackTenantId = null) {
  if (!userId) {
    return {
      tenant: null,
      activeBranch: null,
      allowedBranches: [],
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      role: true,
      email: true,
      name: true,
      phone: true,
      tenant: {
        select: buildTenantSelect(),
      },
    },
  });

  const tenantId = user?.tenantId || fallbackTenantId || null;

  if (!tenantId) {
    return {
      tenant: null,
      activeBranch: null,
      allowedBranches: [],
    };
  }

  const assignments = await prisma.userBranchAssignment
    .findMany({
      where: {
        tenantId,
        userId,
        canOperate: true,
        branch: {
          tenantId,
          status: "ACTIVE",
        },
      },
      orderBy: [{ isDefault: "desc" }],
      select: {
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
    })
    .catch(() => []);

  const branches = assignments
    .map((assignment) => ({
      ...buildBranchPayload(assignment.branch),
      isDefault: Boolean(assignment.isDefault),
      canOperate: Boolean(assignment.canOperate),
      canViewReports: Boolean(assignment.canViewReports),
    }))
    .filter((branch) => branch?.id);

  let activeBranch =
    branches.find((branch) => branch.isDefault) ||
    branches.find((branch) => branch.isMain) ||
    branches[0] ||
    null;

  if (!activeBranch && user?.tenant?.mainBranchId) {
    const mainBranch = await prisma.branch
      .findFirst({
        where: {
          id: user.tenant.mainBranchId,
          tenantId,
          status: "ACTIVE",
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
      })
      .catch(() => null);

    activeBranch = buildBranchPayload(mainBranch);
  }

  return {
    tenant: user?.tenant || null,
    activeBranch,
    allowedBranches: branches,
  };
}

function signAuthToken({ user, tokenId }) {
  assertJwtSecret();

  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      tenantId: user.tenantId,
      email: user.email,
      tokenId,
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

async function enforceTrialGuardOrThrowTx(
  tx,
  { intentId, email, phone, deviceId, browserFingerprint, ip, userAgent }
) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const cleanDeviceId = cleanString(deviceId);
  const cleanFingerprint = cleanString(browserFingerprint);
  const cleanIp = cleanString(ip);

  if (!normalizedEmail || !normalizedPhone || !cleanDeviceId) {
    const err = new Error("Missing email/phone/deviceId for trial");
    err.status = 400;
    throw err;
  }

  const deviceHash = sha256(cleanDeviceId);
  const fingerprintHash = cleanFingerprint ? sha256(cleanFingerprint) : null;
  const ipHash = cleanIp ? sha256(cleanIp) : null;

  const guardChecks = [];

  guardChecks.push({ email: normalizedEmail });
  guardChecks.push({ normalizedEmail });
  guardChecks.push({ phone: normalizedPhone });
  guardChecks.push({ normalizedPhone });
  guardChecks.push({ deviceId: cleanDeviceId });
  guardChecks.push({ deviceHash });

  if (cleanFingerprint) {
    guardChecks.push({ browserFingerprint: cleanFingerprint });
    guardChecks.push({ fingerprintHash });
  }

  if (cleanIp) {
    guardChecks.push({ ip: cleanIp });
    guardChecks.push({ ipHash });
  }

  const dup = await tx.trialGuard.findFirst({
    where: { OR: guardChecks },
    select: {
      id: true,
      email: true,
      phone: true,
      deviceId: true,
      browserFingerprint: true,
      normalizedEmail: true,
      normalizedPhone: true,
      deviceHash: true,
      fingerprintHash: true,
      ip: true,
      ipHash: true,
    },
  });

  if (dup) {
    let blockedReason = "TRIAL_ALREADY_USED";

    if (dup.email === normalizedEmail || dup.normalizedEmail === normalizedEmail) {
      blockedReason = "TRIAL_ALREADY_USED_BY_EMAIL";
    } else if (dup.phone === normalizedPhone || dup.normalizedPhone === normalizedPhone) {
      blockedReason = "TRIAL_ALREADY_USED_BY_PHONE";
    } else if (dup.deviceId === cleanDeviceId || dup.deviceHash === deviceHash) {
      blockedReason = "TRIAL_ALREADY_USED_BY_DEVICE";
    } else if (
      cleanFingerprint &&
      (dup.browserFingerprint === cleanFingerprint || dup.fingerprintHash === fingerprintHash)
    ) {
      blockedReason = "TRIAL_ALREADY_USED_BY_BROWSER";
    } else if (cleanIp && (dup.ip === cleanIp || dup.ipHash === ipHash)) {
      blockedReason = "TRIAL_ALREADY_USED_BY_IP";
    }

    if (intentId) {
      await tx.ownerIntent.update({
        where: { id: intentId },
        data: {
          trialEligibilityCheckedAt: new Date(),
          trialBlockedReason: blockedReason,
        },
      });
    }

    throw createForbiddenTrialError("Free trial already used. Please choose a paid plan.");
  }

  if (intentId) {
    await tx.ownerIntent.update({
      where: { id: intentId },
      data: {
        trialEligibilityCheckedAt: new Date(),
        trialBlockedReason: null,
      },
    });
  }

  await tx.trialGuard.create({
    data: {
      email: normalizedEmail,
      phone: normalizedPhone,
      deviceId: cleanDeviceId,
      browserFingerprint: cleanFingerprint,
      normalizedEmail,
      normalizedPhone,
      deviceHash,
      fingerprintHash,
      ip: cleanIp || null,
      ipHash,
      userAgent: userAgent || null,
      intentId: intentId || null,
      consumedAt: new Date(),
    },
    select: { id: true },
  });
}

async function ownerIntent(req, res) {
  try {
    const {
      storeName,
      ownerName,
      email,
      phone,
      shopType,
      district,
      sector,
      address,
      deviceId,
      browserFingerprint,
      mode,
      planKey,
    } = req.body;

    if (!storeName || !ownerName || !email || !phone) {
      return res.status(400).json({
        message: "storeName, ownerName, email, phone are required",
      });
    }

    const emailNorm = normalizeEmail(email);
    const phoneNorm = normalizePhone(phone);

    if (!emailNorm) return res.status(400).json({ message: "Invalid email format" });

    if (!phoneNorm || !isRwandaMsisdn250(phoneNorm)) {
      return res
        .status(400)
        .json({ message: "Invalid phone format. Use 2507XXXXXXXX or 07XXXXXXXX" });
    }

    const signupMode = String(mode || "TRIAL").trim().toUpperCase();

    if (signupMode !== "PAID" && signupMode !== "TRIAL") {
      return res.status(400).json({ message: "Invalid mode. Use PAID or TRIAL." });
    }

    let requestedPlan = null;

    if (signupMode === "PAID") {
      if (!planKey) return res.status(400).json({ message: "planKey is required for paid signup" });

      requestedPlan = getPlanByKey(planKey);
      if (!requestedPlan) return res.status(400).json({ message: "Invalid planKey" });
    } else {
      requestedPlan = getTrialPlan();
    }

    const requestedSnapshot = snapshotPlanOrNull(requestedPlan);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const intent = await prisma.ownerIntent.create({
      data: {
        storeName: String(storeName).trim(),
        ownerName: String(ownerName).trim(),
        email: emailNorm,
        phone: phoneNorm,
        shopType: cleanString(shopType),
        district: cleanString(district),
        sector: cleanString(sector),
        address: cleanString(address),
        deviceId: cleanString(deviceId),
        browserFingerprint: cleanString(browserFingerprint),
        signupIp: getClientIp(req),
        signupUserAgent: getUserAgent(req),
        requestedPlanKey: requestedSnapshot?.planKey || null,
        requestedTierKey: requestedSnapshot?.tierKey || null,
        requestedCycleKey: requestedSnapshot?.cycleKey || null,
        requestedStaffLimit: requestedSnapshot?.staffLimit ?? null,
        requestedPriceAmount: requestedSnapshot?.requestedPriceAmount ?? null,
        requestedCurrency: requestedSnapshot?.requestedCurrency || null,
        expiresAt,
        status: "PENDING",
      },
      select: {
        id: true,
        storeName: true,
        ownerName: true,
        email: true,
        phone: true,
        shopType: true,
        district: true,
        sector: true,
        address: true,
        deviceId: true,
        browserFingerprint: true,
        emailVerified: true,
        phoneVerified: true,
        trialGrantedAt: true,
        trialEligibilityCheckedAt: true,
        trialBlockedReason: true,
        requestedPlanKey: true,
        requestedTierKey: true,
        requestedCycleKey: true,
        requestedStaffLimit: true,
        requestedPriceAmount: true,
        requestedCurrency: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      intentId: intent.id,
      expiresAt: intent.expiresAt,
      message: "Owner intent created. Proceed to OTP verification.",
      intent,
    });
  } catch (err) {
    console.error("ownerIntent error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

async function login(req, res) {
  try {
    assertJwtSecret();

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const emailNorm = normalizeEmail(email);

    const user = await prisma.user.findUnique({
      where: { email: emailNorm },
      select: {
        id: true,
        tenantId: true,
        role: true,
        name: true,
        email: true,
        phone: true,
        password: true,
        isActive: true,
      },
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.isActive === false) {
      await recordLoginEventSafe(req, {
        tenantId: user.tenantId,
        userId: user.id,
        email: user.email,
        role: user.role,
        status: "BLOCKED",
        method: "PASSWORD",
        reason: "Account is deactivated.",
      });

      return res.status(403).json({ message: "Account is deactivated" });
    }

    const validPassword = await bcrypt.compare(String(password), user.password);

    if (!validPassword) {
      await recordLoginEventSafe(req, {
        tenantId: user.tenantId,
        userId: user.id,
        email: user.email,
        role: user.role,
        status: "FAILED",
        method: "PASSWORD",
        reason: "Incorrect password.",
      });

      return res.status(401).json({ message: "Invalid credentials" });
    }

    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);
    const deviceLabel = parseUserAgent(userAgent);

    await prisma.userSession.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenId,
        ipAddress,
        userAgent,
        expiresAt,
        isRevoked: false,
        lastSeenAt: new Date(),
      },
    });

    recordLoginEventSafe(req, {
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
      role: user.role,
      status: "SUCCESS",
      method: "PASSWORD",
      reason: `${deviceLabel} signed in successfully.`,
    }).catch(() => null);

    const token = signAuthToken({ user, tokenId });

    return res.json({
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      workspaceShouldRefresh: true,
    });

  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

async function confirmSignup(req, res) {
  try {
    assertJwtSecret();

    const { intentId, password, mode, planKey, planDays } = req.body;

    if (!intentId || !password) {
      return res.status(400).json({ message: "intentId and password are required" });
    }

    const passwordIssues = passwordProblems(password);
    if (passwordIssues.length) {
      return res.status(400).json({
        message: `Password is not strong enough. ${passwordIssues.join(" ")}`,
      });
    }

    const signupMode = String(mode || "PAID").toUpperCase();

    if (signupMode !== "PAID" && signupMode !== "TRIAL") {
      return res.status(400).json({ message: "Invalid mode. Use PAID or TRIAL." });
    }

    const intent = await prisma.ownerIntent.findUnique({
      where: { id: String(intentId).trim() },
      select: {
        id: true,
        storeName: true,
        ownerName: true,
        email: true,
        phone: true,
        shopType: true,
        district: true,
        sector: true,
        address: true,
        status: true,
        expiresAt: true,
        emailVerified: true,
        phoneVerified: true,
        deviceId: true,
        browserFingerprint: true,
        requestedPlanKey: true,
        requestedTierKey: true,
        requestedCycleKey: true,
        requestedStaffLimit: true,
        requestedPriceAmount: true,
        requestedCurrency: true,
      },
    });

    if (!intent) return res.status(404).json({ message: "Owner intent not found" });

    if (intent.expiresAt < new Date()) {
      return res.status(403).json({ message: "Owner intent expired" });
    }

    if (intent.status === "CONSUMED") {
      return res
        .status(403)
        .json({ message: "This signup was already completed. Please login." });
    }

    const tenantName = String(intent.storeName || "").trim();
    const ownerName = String(intent.ownerName || "").trim();
    const ownerEmail = normalizeEmail(intent.email);
    const ownerPhone = normalizePhone(intent.phone);

    if (!tenantName || !ownerName || !ownerEmail || !ownerPhone) {
      return res.status(400).json({ message: "Owner intent is missing required info" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(400).json({ message: "An account with this email already exists" });
    }

    let selectedPlan = null;
    let subscriptionDays = 0;

    if (signupMode === "TRIAL") {
      if (!intent.emailVerified || !intent.phoneVerified) {
        return res.status(403).json({
          message: "Verify both email and phone OTP before starting free trial",
        });
      }

      if (!intent.deviceId) {
        return res.status(403).json({
          message: "Missing deviceId for trial. Restart signup on this device.",
        });
      }

      selectedPlan = getTrialPlan();
      subscriptionDays = selectedPlan.days || getTrialDays();
    } else {
      const latestSuccessfulPayment = await prisma.payment.findFirst({
        where: {
          intentId: intent.id,
          purpose: "OWNER_SIGNUP",
          status: "SUCCESS",
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          planKey: true,
          tierKey: true,
          cycleKey: true,
          staffLimit: true,
          branchLimit: true,
          priceAmount: true,
          currency: true,
          createdAt: true,
        },
      });

      const paidIntentSatisfied =
        intent.status === "PAID" || Boolean(latestSuccessfulPayment);

      if (!paidIntentSatisfied) {
        return res.status(403).json({ message: "Payment not completed" });
      }

      const effectivePlanKey =
        cleanString(planKey) ||
        cleanString(latestSuccessfulPayment?.planKey) ||
        cleanString(intent.requestedPlanKey);

      if (effectivePlanKey) selectedPlan = getPlanByKey(effectivePlanKey);

      if (!selectedPlan && Number.isFinite(Number(planDays))) {
        const fallbackDays = Number(planDays);

        if (!Number.isFinite(fallbackDays) || fallbackDays <= 0 || fallbackDays > 3650) {
          return res.status(400).json({ message: "Invalid planDays" });
        }

        selectedPlan = {
          key: cleanString(effectivePlanKey) || "LEGACY_PAID",
          tierKey:
            cleanString(latestSuccessfulPayment?.tierKey) ||
            cleanString(intent.requestedTierKey) ||
            null,
          cycleKey:
            cleanString(latestSuccessfulPayment?.cycleKey) ||
            cleanString(intent.requestedCycleKey) ||
            null,
          label: cleanString(effectivePlanKey) || "Legacy Paid Plan",
          days: fallbackDays,
          price: Number.isFinite(Number(latestSuccessfulPayment?.priceAmount))
            ? Number(latestSuccessfulPayment.priceAmount)
            : Number.isFinite(Number(intent.requestedPriceAmount))
              ? Number(intent.requestedPriceAmount)
              : null,
          currency:
            cleanString(latestSuccessfulPayment?.currency) ||
            cleanString(intent.requestedCurrency) ||
            null,
          staffLimit: Number.isFinite(Number(latestSuccessfulPayment?.staffLimit))
            ? Number(latestSuccessfulPayment.staffLimit)
            : Number.isFinite(Number(intent.requestedStaffLimit))
              ? Number(intent.requestedStaffLimit)
              : null,
          branchLimit: Number.isFinite(Number(latestSuccessfulPayment?.branchLimit))
            ? Number(latestSuccessfulPayment.branchLimit)
            : 1,
        };
      }

      if (!selectedPlan) {
        return res.status(400).json({ message: "Invalid or missing paid plan" });
      }

      subscriptionDays = selectedPlan.days;
    }

    const planSnapshot = getPlanSnapshot(selectedPlan.key) || {
      planKey: selectedPlan.key || null,
      tierKey: selectedPlan.tierKey || null,
      cycleKey: selectedPlan.cycleKey || null,
      label: selectedPlan.label || null,
      tierLabel: selectedPlan.tierLabel || null,
      cycleLabel: selectedPlan.cycleLabel || null,
      days: selectedPlan.days || subscriptionDays,
      price: Number.isFinite(Number(selectedPlan.price)) ? Number(selectedPlan.price) : null,
      currency: selectedPlan.currency || null,
      staffLimit: Number.isFinite(Number(selectedPlan.staffLimit))
        ? Number(selectedPlan.staffLimit)
        : null,
      branchLimit: getBranchLimitFromPlan(selectedPlan, signupMode),
      isEnterprise: Boolean(selectedPlan.isEnterprise),
    };

    const hashedPassword = await bcrypt.hash(String(password), 12);

    const result = await prisma.$transaction(
      async (tx) => {
        if (signupMode === "TRIAL") {
          await enforceTrialGuardOrThrowTx(tx, {
            intentId: intent.id,
            email: ownerEmail,
            phone: ownerPhone,
            deviceId: String(intent.deviceId).trim(),
            browserFingerprint: cleanString(intent.browserFingerprint),
            ip: getClientIp(req),
            userAgent: getUserAgent(req),
          });
        }

        const tenant = await tx.tenant.create({
          data: buildTenantCreateData(intent, ownerEmail, ownerPhone),
          select: buildTenantSelect(),
        });

        const owner = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: ownerName,
            email: ownerEmail,
            phone: ownerPhone,
            password: hashedPassword,
            role: "OWNER",
          },
          select: {
            id: true,
            tenantId: true,
            name: true,
            email: true,
            phone: true,
            role: true,
          },
        });

        const mainBranch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            name: makeMainBranchName(tenantName),
            code: makeMainBranchCode(tenantName),
            type: "MAIN",
            status: "ACTIVE",
            phone: ownerPhone,
            countryCode: "RW",
            isMain: true,
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

        if (fieldExists(tx.tenant, "mainBranchId")) {
          await tx.tenant.update({
            where: { id: tenant.id },
            data: {
              mainBranchId: mainBranch.id,
            },
          });
        }

        await tx.userBranchAssignment.create({
          data: {
            tenantId: tenant.id,
            userId: owner.id,
            branchId: mainBranch.id,
            isDefault: true,
            canOperate: true,
            canViewReports: true,
          },
        });

        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + subscriptionDays);

        const accessMode = signupMode === "TRIAL" ? "TRIAL" : "ACTIVE";

        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            status: "ACTIVE",
            accessMode,
            planKey: planSnapshot.planKey,
            tierKey: planSnapshot.tierKey,
            cycleKey: planSnapshot.cycleKey,
            staffLimit: planSnapshot.staffLimit,
            branchLimit: planSnapshot.branchLimit,
            extraBranchCount: 0,
            priceAmount: planSnapshot.price,
            currency: planSnapshot.currency,
            startDate,
            endDate,
            graceEndDate: null,
            readOnlySince: null,
            lastPaymentAt: signupMode === "PAID" ? new Date() : null,
            renewedAt: signupMode === "PAID" ? new Date() : null,
            trialConsumed: signupMode === "TRIAL",
            trialSourceIntentId: signupMode === "TRIAL" ? intent.id : null,
            trialStartDate: signupMode === "TRIAL" ? startDate : null,
            trialEndDate: signupMode === "TRIAL" ? endDate : null,
          },
        });

        await tx.ownerIntent.update({
          where: { id: intent.id },
          data:
            signupMode === "TRIAL"
              ? {
                  status: "CONSUMED",
                  convertedAt: new Date(),
                  trialGrantedAt: new Date(),
                  trialEligibilityCheckedAt: new Date(),
                  trialBlockedReason: null,
                  requestedPlanKey: planSnapshot.planKey,
                  requestedTierKey: planSnapshot.tierKey,
                  requestedCycleKey: planSnapshot.cycleKey,
                  requestedStaffLimit: planSnapshot.staffLimit,
                  requestedPriceAmount: planSnapshot.price,
                  requestedCurrency: planSnapshot.currency,
                }
              : {
                  status: "CONSUMED",
                  convertedAt: new Date(),
                  requestedPlanKey: planSnapshot.planKey,
                  requestedTierKey: planSnapshot.tierKey,
                  requestedCycleKey: planSnapshot.cycleKey,
                  requestedStaffLimit: planSnapshot.staffLimit,
                  requestedPriceAmount: planSnapshot.price,
                  requestedCurrency: planSnapshot.currency,
                },
        });

        return {
          tenant,
          owner,
          mainBranch,
          planSnapshot,
          startDate,
        };
      },
      {
        maxWait: 15_000,
        timeout: 30_000,
      }
    );

    const tokenId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const ipAddress = getClientIp(req);
    const userAgent = getUserAgent(req);
    const deviceLabel = parseUserAgent(userAgent);

    await prisma.userSession.create({
      data: {
        tenantId: result.tenant.id,
        userId: result.owner.id,
        tokenId,
        ipAddress,
        userAgent,
        expiresAt,
        isRevoked: false,
        lastSeenAt: new Date(),
      },
    });

    await recordLoginEventSafe(req, {
      tenantId: result.tenant.id,
      userId: result.owner.id,
      email: result.owner.email,
      role: result.owner.role,
      status: "SUCCESS",
      method: signupMode === "TRIAL" ? "TRIAL_SIGNUP" : "PAID_SIGNUP",
      reason: `${deviceLabel} created owner access.`,
    });

    const token = signAuthToken({
      user: {
        id: result.owner.id,
        tenantId: result.tenant.id,
        role: "OWNER",
        email: result.owner.email,
      },
      tokenId,
    });

    const workspace = await getWorkspaceContextForUser(result.owner.id, result.tenant.id);

    return res.status(201).json({
      message: signupMode === "TRIAL" ? "Trial started" : "Tenant created successfully",
      token,
      tenantId: result.tenant.id,
      ownerEmail: result.owner.email,
      mode: signupMode,
      subscriptionDays,

      user: {
        id: result.owner.id,
        tenantId: result.owner.tenantId,
        role: result.owner.role,
        name: result.owner.name,
        email: result.owner.email,
        phone: result.owner.phone,
      },

      tenant: workspace.tenant || result.tenant,

      mainBranch: buildBranchPayload(result.mainBranch),
      activeBranch: workspace.activeBranch || buildBranchPayload(result.mainBranch),
      allowedBranches:
        workspace.allowedBranches && workspace.allowedBranches.length
          ? workspace.allowedBranches
          : [
              {
                ...buildBranchPayload(result.mainBranch),
                isDefault: true,
                canOperate: true,
                canViewReports: true,
              },
            ],

      subscription: {
        planKey: result.planSnapshot.planKey,
        tierKey: result.planSnapshot.tierKey,
        cycleKey: result.planSnapshot.cycleKey,
        staffLimit: result.planSnapshot.staffLimit,
        branchLimit: result.planSnapshot.branchLimit,
        extraBranchCount: 0,
        priceAmount: result.planSnapshot.price,
        currency: result.planSnapshot.currency,
        startDate: result.startDate,
      },
    });
  } catch (err) {
    console.error("confirmSignup error:", err);
    return res.status(err.status || 500).json({ message: err.message || "Signup failed" });
  }
}

async function initiateSignup(req, res) {
  return res.json({ message: "Signup initiated (mock)" });
}

async function forgotPassword(req, res) {
  return res.json({ message: "Password reset token sent (mock)" });
}

async function resetPassword(req, res) {
  return res.json({ message: "Password reset completed (mock)" });
}

module.exports = {
  ownerIntent,
  login,
  initiateSignup,
  confirmSignup,
  forgotPassword,
  resetPassword,
};