// routes/userRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getMe } = require("../controllers/userController");

router.get("/me", protect, getMe);

module.exports = router;