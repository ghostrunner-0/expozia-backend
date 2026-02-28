// src/routes/scanRoutes.js
const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/authMiddleware");
const {
  textScan,
  imageScan,
  linkCheck,
  listSessions,
  getSession,
  newSession,
  uploadImage,
} = require("../controllers/scanController");

// scans
router.post("/text", protect, textScan);
router.post("/image", protect, uploadImage, imageScan); // ✅ multer added
router.post("/link", protect, linkCheck);

// chat history
router.get("/sessions", protect, listSessions);
router.post("/sessions", protect, newSession);
router.get("/sessions/:id", protect, getSession);

module.exports = router;