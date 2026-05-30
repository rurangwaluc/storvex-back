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
const permissionsRoutes = require("./modules/auth/permissions.routes");

const userRoutes = require("./modules/users/users.routes");
const tenantRoutes = require("./modules/tenants/tenants.routes");
const posRoutes = require("./modules/pos/pos.routes");
const cashDrawerRouter = require("./modules/cashDrawer/cashDrawer.routes");
const storeRoutes = require("./modules/store/store.routes");
const branchesRoutes = require("./modules/branches/branches.routes");

const repairRoutes = require("./modules/repairs/repairs.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const customerRoutes = require("./modules/customers/customers.routes");
const reportRoutes = require("./modules/reports/reports.routes");
const interstoreRoutes = require("./modules/interStore/interStore.routes");

const supplierRoutes = require("./modules/suppliers/suppliers.routes");
const expenseRoutes = require("./modules/expenses/expenses.routes");
const billingRoutes = require("./modules/billing/billing.routes");
const auditRoutes = require("./modules/audit/audit.routes");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes");
const employeeRoutes = require("./modules/employees/employee.routes");

const whatsappRoutes = require("./modules/whatsapp/whatsapp.routes");
const whatsappAccountsRoutes = require("./modules/whatsapp/whatsapp.accounts.routes");
const whatsappInboxRoutes = require("./modules/whatsapp/whatsapp.inbox.routes");

const deliveryNotesRoutes = require("./modules/deliveryNotes/deliveryNotes.routes");
const receiptsRoutes = require("./modules/receipts/receipts.routes");
const invoicesRoutes = require("./modules/invoices/invoices.routes");
const proformasRoutes = require("./modules/proformas/proformas.routes");
const warrantiesRoutes = require("./modules/warranties/warranties.routes");

const securityRoutes = require("./modules/settings/security.routes");

const platformRoutes = require("./modules/platform/platform.routes");
const platformAuthRoutes = require("./modules/platform/platform.auth.routes");
const platformTenantRoutes = require("./modules/platform/platform.tenants.routes");
const platformUsersRoutes = require("./modules/platform/platform.users.routes");
const platformAuditRoutes = require("./modules/platform/platform.audit.routes");
const platformBillingRoutes = require("./modules/platform/platform.billing.routes");
const platformSupportRoutes = require("./modules/platform/platform.support.routes");
const platformSupportAttachmentsRoutes = require("./modules/supportTickets/platformSupportAttachments.routes");

const supportTicketsRoutes = require("./modules/supportTickets/supportTickets.routes");
const platformSupportTicketsRoutes = require("./modules/supportTickets/platformSupportTickets.routes");
const supportAttachmentsRoutes = require("./modules/supportTickets/supportAttachments.routes");



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

app.get("/api", authenticate, requireActiveSubscription, (req, res) => {
  res.json({ message: "Storvex API root" });
});

app.get("/api/auth-test", authenticate, (req, res) => {
  res.json({ message: "Authentication successful", user: req.user });
});

// Auth
app.use("/api/auth", authRoutes);
app.use("/api/auth/permissions", permissionsRoutes);

// Platform
// Specific platform routes must be mounted before the broad /api/platform route.
// Otherwise /api/platform can catch /api/platform/users before platformUsersRoutes runs.
app.use("/api/platform/auth", platformAuthRoutes);
app.use("/api/platform/audit", platformAuditRoutes);
app.use("/api/platform/tenants", platformTenantRoutes);
app.use("/api/platform/users", platformUsersRoutes);
app.use("/api/platform/billing", platformBillingRoutes);
app.use("/api/platform/support", platformSupportRoutes);
app.use("/api/platform/support/tickets", platformSupportTicketsRoutes);
app.use("/api/platform/support/attachments", platformSupportAttachmentsRoutes);
app.use("/api/support/attachments", supportAttachmentsRoutes);
app.use("/api/platform", platformRoutes);

// Tenant / workspace-level modules
app.use("/api/tenants", tenantRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/branches", branchesRoutes);

app.use(
  "/api/support/tickets",
  authenticate,
  requireTenant,
  supportTicketsRoutes
);

// Store module
// Auth + tenant + active subscription at mount level.
// Fine-grained authorization is handled inside store.routes.js.
app.use(
  "/api/store",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  storeRoutes
);

// Cash drawer module
// Auth + tenant + active subscription at mount level.
// Fine-grained authorization is handled inside cashDrawer.routes.js.
app.use(
  "/api/cash-drawer",
  authenticate,
  requireTenant,
  requireActiveSubscription,
  cashDrawerRouter
);

// Documents
app.use("/api/delivery-notes", deliveryNotesRoutes);
app.use("/api/receipts", receiptsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/proformas", proformasRoutes);
app.use("/api/warranties", warrantiesRoutes);

// Core business modules
app.use("/api/users", userRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customers", customerRoutes);
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

// WhatsApp account management (OWNER only for now)
app.use(
  "/api/whatsapp",
  authenticate,
  requireTenant,
  requireRole("OWNER"),
  whatsappAccountsRoutes
);

// WhatsApp inbox / protected actions inside its own route layer
app.use("/api/whatsapp", whatsappInboxRoutes);

// Settings
app.use("/api/settings/security", securityRoutes);

module.exports = app;