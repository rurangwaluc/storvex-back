const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

console.log("Prisma client loaded from:", require.resolve("@prisma/client"));

const prisma = new PrismaClient({});

const JWT_SECRET = process.env.JWT_SECRET;

// --------------------------
// OWNER INTENT (STEP 1)
// --------------------------

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
    } = req.body;

    // Required fields
    if (!storeName || !ownerName || !email || !phone) {
      return res.status(400).json({
        message: "storeName, ownerName, email, phone are required",
      });
    }

    // Basic Rwanda phone format: 2507XXXXXXXX
    const msisdnRegex = /^2507\d{8}$/;
    if (!msisdnRegex.test(String(phone).trim())) {
      return res.status(400).json({
        message: "Invalid phone format. Use 2507XXXXXXXX",
      });
    }

    // Basic email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(email).trim())) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const intent = await prisma.ownerIntent.create({
      data: {
        storeName: String(storeName).trim(),
        ownerName: String(ownerName).trim(),
        email: String(email).trim().toLowerCase(),
        phone: String(phone).trim(),

        shopType: shopType ? String(shopType).trim() : null,
        district: district ? String(district).trim() : null,
        sector: sector ? String(sector).trim() : null,
        address: address ? String(address).trim() : null,

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
        status: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return res.status(201).json({
      intentId: intent.id,
      expiresAt: intent.expiresAt,
      message: "Owner intent created. Proceed to payment.",
      intent,
    });
  } catch (err) {
    console.error("ownerIntent error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// --------------------------
// Tenant login (owner & staff)
// --------------------------
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        role: user.role,
        tenantId: user.tenantId,
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.json({ token });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
}

// --------------------------
// Tenant signup (initiated after payment)
// --------------------------
async function initiateSignup(req, res) {
  // Placeholder: payment verification logic goes here
  return res.json({ message: "Signup initiated (mock)" });
}

async function confirmSignup(req, res) {
  try {
    const { intentId, password, planDays } = req.body;

    // 1) Validate required fields
    if (!intentId || !password) {
      return res
        .status(400)
        .json({ message: "intentId and password are required" });
    }

    // Default planDays if not provided (starter)
    const days = Number(planDays || 30);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return res.status(400).json({ message: "Invalid planDays" });
    }

    // 2) Fetch owner intent
    const intent = await prisma.ownerIntent.findUnique({
      where: { id: intentId },
    });

    if (!intent) {
      return res.status(404).json({ message: "Owner intent not found" });
    }

    // 3) Enforce payment + state
    if (intent.status !== "PAID") {
      return res.status(403).json({ message: "Payment not completed" });
    }

    if (intent.expiresAt < new Date()) {
      return res.status(403).json({ message: "Owner intent expired" });
    }

    // 4) Build tenant + owner data from intent
    // NOTE: Your schema currently has storeName/ownerName/email/phone on OwnerIntent.
    const tenantName = intent.storeName;
    const tenantEmail = intent.email;
    const tenantPhone = intent.phone;

    const ownerName = intent.ownerName;
    const ownerEmail = intent.email; // same as tenant email for now
    const ownerPhone = intent.phone;

    if (!tenantName || !tenantEmail || !ownerName || !ownerEmail) {
      return res.status(400).json({
        message:
          "Owner intent is missing required info (storeName/ownerName/email)",
      });
    }

    // 5) Prevent duplicate tenant creation (if confirm called twice)
    // If you later add tenantId on OwnerIntent, this becomes even easier.
    const existingUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "An account with this email already exists" });
    }

    // 6) Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 7) Create tenant + owner + subscription atomically
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: tenantName,
          email: tenantEmail,
          phone: tenantPhone,
          status: "ACTIVE",
        },
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
      });

      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + days);

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          status: "ACTIVE",
          startDate,
          endDate,
        },
      });

      // Mark intent consumed + converted timestamp
      await tx.ownerIntent.update({
        where: { id: intentId },
        data: { status: "CONSUMED", convertedAt: new Date() },
      });

      return { tenant, owner };
    });

    // 8) Issue JWT
    const token = jwt.sign(
      {
        userId: result.owner.id,
        tenantId: result.tenant.id,
        role: "OWNER",
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    return res.status(201).json({
      message: "Tenant created successfully",
      token,
      tenantId: result.tenant.id,
      ownerEmail: result.owner.email,
    });
  } catch (error) {
    console.error("confirmSignup error:", error);
    return res.status(500).json({ message: "Signup failed" });
  }
}

// --------------------------
// Password reset
// --------------------------
async function forgotPassword(req, res) {
  // Placeholder
  return res.json({ message: "Password reset token sent (mock)" });
}

async function resetPassword(req, res) {
  // Placeholder
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
