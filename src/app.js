const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const dashboardRoutes = require("./routes/dashboardRoutes");

const app = express();

// ✅ Allowed origins
const ALLOWED_ORIGINS = [
  "https://expozia-frontend.vercel.app",
  "http://localhost:3000",
];

// Security middleware
app.use(helmet());

// ✅ CORS with explicit config (important for preflight)
app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server / Postman (no origin)
      if (!origin) return callback(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      return callback(new Error("Not allowed by CORS: " + origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ✅ MUST handle preflight before routes
app.options("*", cors());

// Body parser
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/scan", require("./routes/scanRoutes"));
// ⚠️ remove duplicate
// app.use("/api/scan", require("./routes/scanRoutes"));

app.use("/api/user", require("./routes/UserRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/reports", require("./routes/reportRoutes"));
app.use("/api/dashboard", dashboardRoutes);

module.exports = app;
