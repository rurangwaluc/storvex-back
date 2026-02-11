// Load environment variables from .env file
require("dotenv").config(); 

// Import dependencies
const express = require("express");
const cors = require("cors");
const authenticate = require("./middlewares/authenticate");
const authRoutes = require("./modules/auth/auth.routes");
const userRoutes = require("./modules/users/users.routes");
const tenantRoutes = require("./modules/tenants/tenants.routes");
const posRoutes = require("./modules/pos/pos.routes");
const repairRoutes = require("./modules/repairs/repairs.routes");
const inventoryRoutes = require("./modules/inventory/inventory.routes");
const customerRoutes = require("./modules/customers/customers.routes");
const reportRoutes = require("./modules/reports/reports.routes");
const interstoreRoutes = require("./modules/interStore/interStore.routes");
// const paymentsRoutes = require("./modules/payments/payments.routes");
const requireActiveSubscription = require("./middlewares/requireActiveSubscription");

const app = express();

// Use CORS with default options, allowing all origins
app.use(cors());

// Global middleware to parse JSON requests
app.use(express.json());

// Health check route to verify the service is running
app.get("/health", (req, res) => {
  res.json({ status: "OK", service: "Storvex API" });
});

// Authentication routes (Public routes)
app.use("/api/auth", authRoutes);

// API root route (requires authentication and active subscription)
app.get("/api", authenticate, requireActiveSubscription, (req, res) => {
  res.json({ message: "Storvex API root" });
});

// Hard test route for authentication (will only be accessible if the user is authenticated)
app.get("/api/auth-test", authenticate, (req, res) => {
  res.json({
    message: "Authentication successful",
    user: req.user, // Assuming `authenticate` middleware sets `req.user`
  });
});

// Payments routes (currently commented out, can be added in the future)
// app.use("/api/payments", paymentsRoutes);

// Platform routes (for platform-level functionality)
app.use("/api/platform", require("./modules/platform/platform.routes"));
app.use("/api/platform/auth", require("./modules/platform/platform.auth.routes"));

// Tenants routes (for tenant-level functionality)
app.use("/api/tenants", tenantRoutes);

// Dashboard routes (for dashboard-related functionality)
app.use("/api/dashboard", require("./modules/dashboard/dashboard.routes"));

// Employees routes (for employee-related functionality)
app.use("/api/employees", require("./modules/employees/employee.routes"));

// Audit routes (for audit logging and tracking)
app.use("/api/audit", require("./modules/audit/audit.routes"));

// Expenses routes (for expense management)
app.use("/api/expenses", require("./modules/expenses/expenses.routes"));

// Users routes (for user management)
app.use("/api/users", userRoutes);

// POS routes (for point-of-sale functionality)
app.use("/api/pos", posRoutes);

// Inventory routes (for inventory management)
app.use("/api/inventory", inventoryRoutes);

// Customers routes (for customer management, protected by authentication)
app.use("/api/customers", authenticate, customerRoutes);

// Repairs routes (for repair management)
app.use("/api/repairs", repairRoutes);

// Reports routes (for report generation)
app.use("/api/reports", reportRoutes);

// Interstore routes (for interstore operations)
app.use("/api/interstore", interstoreRoutes);

module.exports = app;
