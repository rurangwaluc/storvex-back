const prisma = require("../../config/database");

// DASHBOARD METRICS
async function dashboard(req, res) {
  try {
    const [
      totalTenants,
      activeTenants,
      expiredSubscriptions,
      newTenants
    ] = await Promise.all([
      prisma.tenant.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
      prisma.subscription.count({ where: { status: "EXPIRED" } }),
      prisma.tenant.count({
        where: {
          createdAt: {
            gte: new Date(
              new Date().setDate(new Date().getDate() - 30)
            )
          }
        }
      })
    ]);

    res.json({
      totalTenants,
      activeTenants,
      expiredSubscriptions,
      totalRevenue: null, // not tracked in V1
      newTenantsLast30Days: newTenants
    });
  } catch (err) {
    console.error("Platform dashboard error:", err);
    res.status(500).json({ message: "Failed to load dashboard" });
  }
}


// LIST TENANTS
async function listTenants(req, res) {
  const tenants = await prisma.tenant.findMany({
    include: {
      subscription: true,
      users: true
    },
    orderBy: { createdAt: "desc" }
  });

  res.json(tenants);
}

// TENANT DETAILS
async function getTenantDetails(req, res) {
  const { tenantId } = req.params;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      subscription: true,
      users: true,
    },
  });

  if (!tenant) {
    return res.status(404).json({ message: "Tenant not found" });
  }

  res.json(tenant);
}


// LIST SUBSCRIPTIONS
async function listSubscriptions(req, res) {
  const subs = await prisma.subscription.findMany({
    include: {
      tenant: true
    },
    orderBy: { createdAt: "desc" }
  });

  res.json(subs);
}

// LIST OWNER INTENTS
async function listOwnerIntents(req, res) {
  const intents = await prisma.ownerIntent.findMany({
    orderBy: { createdAt: "desc" }
  });

  res.json(intents);
}

// UPDATE TENANT STATUS
async function updateTenantStatus(req, res) {
  const { tenantId } = req.params;
  const { status } = req.body;

  if (!["ACTIVE", "SUSPENDED"].includes(status)) {
    return res.status(400).json({ message: "Invalid status value" });
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: { status },
  });

  res.json(tenant);
}

module.exports = {
  dashboard,
  listTenants,
  getTenantDetails,
  updateTenantStatus,
  listSubscriptions,
  listOwnerIntents,
};
