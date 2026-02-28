const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();

const ALLOWED_ORIGINS = [
  "https://expozia-frontend.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(helmet());

app.use(
  cors({
    origin: (origin, cb) => {
      // allow Postman/server-to-server (no origin)
      if (!origin) return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

      return cb(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false, // keep false since you're using Bearer token, not cookies
  })
);

// ✅ very important for preflight
app.options("*", cors());

app.use(express.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/scan", require("./routes/scanRoutes"));
// ❌ remove duplicate
app.get("/api/health", (req, res) => res.json({ ok: true }));
// app.use("/api/scan", require("./routes/scanRoutes"));
app.use("/api/user", require("./routes/UserRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/dashboard", dashboardRoutes);

module.exports = app;
