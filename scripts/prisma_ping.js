require("dotenv").config();
const prisma = require("../src/config/database");

async function main() {
  const r = await prisma.$queryRaw`select now() as now`;
  console.log(r);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});