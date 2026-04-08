require("dotenv").config();

const express = require("express");
const cors = require("cors");

const authenticate = require("./middlewares/authenticate");
const requireTenant = require("./middlewares/requireTenant");
const requireRole = require("./middlewares/requireRole");
const {
  requireActiveSubscription,
} = require("./middlewares/requireActiveSubscription");

const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/users/users.routes");
const tenantRoutes = require("./modules/tenants/tenants.routes");
const posRoutes = require("./modules/pos/pos.routes");
const cashDrawerRouter = require("./modules/cashDrawer/cashDrawer.routes");
const storeRoutes = require("./modules/store/store.routes");

const repairRoutes = require("./modules/repairs/repairs.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const customerRoutes = require("./modules/customers/customers.routes");
const reportRoutes = require("./modules/reports/reports.routes");
const interstoreRoutes = require("./modules/interStore/interStore.routes");

const whatsappRoutes = require("./modules/whatsapp/whatsapp.routes");
const whatsappAccountsRoutes = require("./modules/whatsapp/whatsapp.accounts.routes");
const whatsappInboxRoutes = require("./modules/whatsapp/whatsapp.inbox.routes");

const deliveryNotesRoutes = require("./modules/deliveryNotes/deliveryNotes.routes");
const receiptsRoutes = require("./modules/receipts/receipts.routes");
const invoicesRoutes = require("./modules/invoices/invoices.routes");
const proformasRoutes = require("./modules/proformas/proformas.routes");
const warrantiesRoutes = require("./modules/warranties/warranties.routes");

const permissionsRoutes = require("./modules/auth/permissions.routes");

const securityRoutes = require("./modules/settings/security.routes");

const app = express();

app.use(cors());

/**
 * IMPORTANT
 * Webhook MUST be raw bytes so signature verification uses exact payload.
 * This must run BEFORE global express.json().
 */
app.use("/api/whatsapp/webhook", express.raw({ type: "*/*" }));

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "Storvex API" });
});

// Auth routes
app.use("/api/auth", authRoutes);

// Permissions routes
app.use("/api/auth/permissions", permissionsRoutes);

app.get("/api", authenticate, requireActiveSubscription, (req, res) => {
  res.json({ message: "Storvex API root" });
});

app.get("/api/auth-test", authenticate, (req, res) => {
  res.json({ message: "Authentication successful", user: req.user });
});

// Platform routes
app.use("/api/platform", require("./modules/platform/platform.routes"));
app.use("/api/platform/auth", require("./modules/platform/platform.auth.routes"));

// Tenant routes
app.use("/api/tenants", tenantRoutes);

// Other modules
app.use("/api/dashboard", require("./modules/dashboard/dashboard.routes"));
app.use("/api/employees", require("./modules/employees/employee.routes"));
app.use("/api/audit", require("./modules/audit/audit.routes"));
app.use("/api/expenses", require("./modules/expenses/expenses.routes"));
app.use("/api/billing", require("./modules/billing/billing.routes"));
app.use("/api/suppliers", require("./modules/suppliers/suppliers.routes"));

app.use(
  "/api/store",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "MANAGER", "STOREKEEPER", "SELLER", "CASHIER", "TECHNICIAN"),
  storeRoutes
);

app.use(
  "/api/cash-drawer",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  requireRole("OWNER", "MANAGER", "CASHIER"),
  cashDrawerRouter
);

// Document routes
app.use("/api/delivery-notes", deliveryNotesRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/proformas", proformasRoutes);
app.use("/api/warranties", warrantiesRoutes);

// Core business routes
app.use("/api/users", userRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", authenticate, customerRoutes);
app.use("/api/repairs", repairRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/interstore", interstoreRoutes);

// WhatsApp webhook (public)
app.use(
  "/api/whatsapp",
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  }),
  whatsappRoutes
);

// WhatsApp accounts (OWNER only)
app.use(
  "/api/whatsapp",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  whatsappAccountsRoutes
);

// WhatsApp inbox / protected actions inside its own route layer
app.use("/api/whatsapp", whatsappInboxRoutes);

app.use("/api/settings/security", securityRoutes);

module.exports = app;