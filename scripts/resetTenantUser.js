const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function reset() {
  const email = "beta@owner.com"; // CHANGE THIS
  const hash = await bcrypt.hash("Owner@123", 10);

  await prisma.user.update({
    where: { email },
    data: { password: hash },
  });

  console.log("Tenant user password reset:", email);
}

reset();
