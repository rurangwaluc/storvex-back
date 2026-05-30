const bcrypt = require("bcryptjs");
const prisma = require("../src/config/database");

async function main() {
  const email = String(process.env.PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
  const name = String(process.env.PLATFORM_OWNER_NAME || "Luc Rurangwa").trim();
  const password = String(process.env.PLATFORM_OWNER_PASSWORD || "");

  if (!email || !password) {
    throw new Error("PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD are required");
  }

  if (password.length < 8) {
    throw new Error("PLATFORM_OWNER_PASSWORD must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const owner = await prisma.platformUser.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: "PLATFORM_OWNER",
      isActive: true,
    },
    create: {
      name,
      email,
      passwordHash,
      role: "PLATFORM_OWNER",
      isActive: true,
    },
  });

  console.log("Platform owner ready:", {
    id: owner.id,
    name: owner.name,
    email: owner.email,
    role: owner.role,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });