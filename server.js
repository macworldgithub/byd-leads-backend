// const dns = require('dns')
// dns.setDefaultResultOrder('ipv4first');
// dns.setServers(['8.8.8.8', '8.8.4.4']);
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const leadsRouter = require("./routes/leads");
const dealershipsRouter = require("./routes/dealerships");
const inventoryRouter = require("./routes/inventory");
const conversationsRouter = require("./routes/conversations");
const appointmentsRouter = require("./routes/appointments");
const dashboardRouter = require("./routes/dashboard");
const settingsRouter = require("./routes/settings");
const auditTrailsRouter = require("./routes/auditTrails");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    db: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ──────────────────────────────────────────────────────────────
app.use("/api/dashboard", dashboardRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/dealerships", dealershipsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/audit-trails", auditTrailsRouter);

// ── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ── MongoDB + Start ──────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB connected: ${process.env.MONGO_URI}`);
    app.listen(PORT, () => {
      console.log(`🚀 BYD Lead Centre API running at http://localhost:${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health`);
      console.log(`\n📡 Endpoints:`);
      console.log(`   GET  /api/dashboard`);
      console.log(`   GET  /api/leads`);
      console.log(`   POST /api/leads`);
      console.log(`   GET  /api/dealerships`);
      console.log(`   GET  /api/inventory`);
      console.log(`   GET  /api/conversations`);
      console.log(`   GET  /api/appointments`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  });
