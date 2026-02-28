// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

// ✅ Trust proxy for Vercel (rate-limit, IP)
app.set("trust proxy", 1);

// --------------------
// Middlewares
// --------------------
app.use(helmet());

const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// --------------------
// Health routes
// --------------------
app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "expozia-backend" });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// --------------------
// Routes (IMPORTANT: check file name cases)
// --------------------
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/scan", require("./routes/scanRoutes"));
app.use("/api/user", require("./routes/UserRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/dashboard", require("./routes/dashboardRoutes"));

// --------------------
// 404
// --------------------
app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Route not found", path: req.originalUrl });
});

// --------------------
// Error handler
// --------------------
app.use((err, req, res, next) => {
  console.error("🔥 Error:", err);
  res.status(500).json({ ok: false, message: err?.message || "Internal Server Error" });
});

module.exports = app;
