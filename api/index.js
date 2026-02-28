const app = require("../src/app");
const connectDB = require("../src/config/db");

let isConnected = false;

module.exports = async (req, res) => {
  try {
    if (!isConnected) {
      await connectDB();
      isConnected = true;
    }
    return app(req, res);
  } catch (err) {
    console.error("❌ Function crashed:", err);
    return res.status(500).json({
      ok: false,
      message: "Serverless function crashed",
      error: err?.message || String(err),
    });
  }
};
