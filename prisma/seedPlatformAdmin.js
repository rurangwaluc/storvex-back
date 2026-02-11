const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = "admin@storvex.io";
  const password = "AdminPass@26!";

  // Delete any existing admin
  await prisma.platformUser.deleteMany({ where: { email } });

  const hashedPassword = await bcrypt.hash(password, 10);

  await prisma.platformUser.create({
    data: {
      email,
      password: hashedPassword,
      role: "PLATFORM_ADMIN",
    },
  });

  console.log("✅ Platform admin created/updated");
  console.log("Email:", email);
  console.log("Password:", password);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
