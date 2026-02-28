// controllers/userController.js
const ChatSession = require("../models/ChatSession");

function monthLabel(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[d.getMonth()];
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

exports.getMe = async (req, res, next) => {
  try {
    // req.user should be attached by protect middleware
    const u = req.user;
    if (!u?._id) return res.status(401).json({ message: "Unauthorized" });

    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const nextMonthStart = endOfMonth(now);

    // total scans = all sessions (or you can count messages if you want)
    const totalScans = await ChatSession.countDocuments({ user: u._id });

    const scansThisMonth = await ChatSession.countDocuments({
      user: u._id,
      createdAt: { $gte: thisMonthStart, $lt: nextMonthStart },
    });

    // avg daily = this month scans / days elapsed (min 1)
    const dayOfMonth = Math.max(1, now.getDate());
    const avgDaily = Math.round((scansThisMonth / dayOfMonth) * 10) / 10;

    // build last 6 months chart (sessions per month)
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthly = await ChatSession.aggregate([
      {
        $match: {
          user: u._id,
          createdAt: { $gte: start, $lte: now },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: "$createdAt" },
            m: { $month: "$createdAt" },
          },
          scans: { $sum: 1 },
        },
      },
      { $sort: { "_id.y": 1, "_id.m": 1 } },
    ]);

    const map = new Map();
    for (const row of monthly) {
      const key = `${row._id.y}-${row._id.m}`;
      map.set(key, row.scans);
    }

    const chart = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      chart.push({ month: monthLabel(d), scans: map.get(key) || 0 });
    }

    // OPTIONAL % changes (simple compare with previous month)
    const prevMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const thisMonthStart2 = thisMonthStart;

    const prevMonthScans = await ChatSession.countDocuments({
      user: u._id,
      createdAt: { $gte: prevMonthStart, $lt: thisMonthStart2 },
    });

    const changeMonthPct =
      prevMonthScans === 0 ? (scansThisMonth > 0 ? 100 : 0) : ((scansThisMonth - prevMonthScans) / prevMonthScans) * 100;

    return res.json({
      user: {
        name: u.fullName,
        email: u.email,
        plan: "Free", // if you add plan later, replace this
        role: "Member",
        memberSince: u.createdAt, // from timestamps
      },
      usage: {
        totalScans,
        scansThisMonth,
        avgDaily,
        changeMonthPct,
        chart,
      },
    });
  } catch (e) {
    next(e);
  }
};