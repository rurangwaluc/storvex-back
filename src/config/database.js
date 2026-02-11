const { PrismaClient } = require("@prisma/client");

const prisma = global.__prisma__ || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Check your .env");
}


module.exports = prisma;
