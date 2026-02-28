// routes/reportRoutes.js
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { getReportsSummary } = require("../controllers/reportController");

router.get("/summary", protect, getReportsSummary);

module.exports = router;