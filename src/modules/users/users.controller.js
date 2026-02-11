const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function createStaff(req, res) {
  try {
    const { name, email, phone, role, password } = req.body;

    // 1. Validate input
    if (!name || !email || !role || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!["CASHIER", "TECHNICIAN"].includes(role)) {
      return res.status(400).json({
        message: "Invalid role. Only CASHIER or TECHNICIAN allowed",
      });
    }

    // 2. Ensure email is unique
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    // 3. Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. Create user in SAME tenant as owner
    const user = await prisma.user.create({
      data: {
        tenantId: req.user.tenantId,
        name,
        email,
        phone,
        role,
        password: hashedPassword,
      },
    });

    return res.status(201).json({
      message: `${role} created successfully`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Failed to create user" });
  }
}

module.exports = {
  createStaff,
};
