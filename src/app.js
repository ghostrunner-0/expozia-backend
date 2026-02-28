require("dotenv").config();
const app = require("./src/app");
const connectDB = require("./src/config/db");

// Connect to Database
connectDB();

// Only listen if not running on Vercel
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// CRITICAL: Export the app for Vercel's serverless handler
module.exports = app;