// routes/chatRoutes.js
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const { askDashboardAssistant } = require("../controllers/chatController");

router.post("/ask", protect, askDashboardAssistant);

module.exports = router;