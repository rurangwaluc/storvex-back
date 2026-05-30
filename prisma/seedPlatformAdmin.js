const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL || "admin@storvex.io";
  const password = process.env.PLATFORM_ADMIN_PASSWORD || "AdminPass@26!";
  const name = process.env.PLATFORM_ADMIN_NAME || "Storvex Platform Admin";

  const hashedPassword = await bcrypt.hash(password, 12);

  await prisma.platformUser.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      name,
      role: "PLATFORM_ADMIN",
      isActive: true,
    },
    create: {
      email,
      password: hashedPassword,
      name,
      role: "PLATFORM_ADMIN",
      isActive: true,
    },
  });

  console.log("Platform admin is ready");
  console.log("Email:", email);
  console.log("Password:", password);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());