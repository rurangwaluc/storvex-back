const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

module.exports = async function requirePlatform(req, res, next) {
  try {
    // Token already decoded by authenticate middleware
    const { userId, role, platform } = req.user;

    // Must be explicitly marked as platform token
    if (!platform) {
      return res.status(403).json({ message: "Platform access only" });
    }

    // Fetch platform user
    const platformUser = await prisma.platformUser.findUnique({
      where: { id: userId }
    });

    if (!platformUser) {
      return res.status(403).json({ message: "Invalid platform user" });
    }

    if (platformUser.role !== "PLATFORM_ADMIN") {
      return res.status(403).json({ message: "Insufficient privileges" });
    }

    req.platformUser = platformUser;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Platform auth failed" });
  }
};
