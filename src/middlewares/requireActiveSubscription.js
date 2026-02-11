const prisma = require("../config/database");

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function requireActiveSubscription(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    // Platform users or non-tenant routes
    if (!tenantId) return next();

    const subscription = await prisma.subscription.findUnique({
      where: { tenantId },
      select: { status: true, endDate: true, startDate: true },
    });

    if (!subscription) {
      return res.status(402).json({ message: "No subscription found. Please subscribe." });
    }

    const now = new Date();
    const end = new Date(subscription.endDate);
    const graceDays = toInt(process.env.GRACE_DAYS, 0);

    // Expired by date
    if (end < now) {
      // Compute grace end
      const graceEnd = new Date(end);
      graceEnd.setDate(graceEnd.getDate() + graceDays);

      // If within grace window, allow but attach a flag for UI warnings
      if (graceDays > 0 && graceEnd >= now) {
        req.subscription = {
          status: subscription.status,
          endDate: subscription.endDate,
          inGrace: true,
          graceDays,
        };
        return next();
      }

      // Update status to EXPIRED once (optional but useful)
      if (subscription.status !== "EXPIRED") {
        await prisma.subscription.update({
          where: { tenantId },
          data: { status: "EXPIRED" },
        });
      }

      return res.status(402).json({
        message: "Subscription expired. Please renew to continue.",
        endDate: subscription.endDate,
      });
    }

    // Suspended / inactive
    if (subscription.status !== "ACTIVE") {
      return res.status(402).json({ message: "Subscription not active. Please renew." });
    }

    req.subscription = {
      status: subscription.status,
      endDate: subscription.endDate,
      inGrace: false,
    };

    return next();
  } catch (err) {
    console.error("requireActiveSubscription error:", err);
    return res.status(500).json({ message: "Subscription enforcement failed" });
  }
}

module.exports = requireActiveSubscription;
