// controllers/dashboardController.js
const ChatSession = require("../models/ChatSession");

function clamp(n, a, b) {
  n = Number(n);
  if (Number.isNaN(n)) n = 0;
  return Math.max(a, Math.min(b, n));
}

function getStartOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getEndOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function last7Days() {
  const today = getStartOfDay(new Date());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}

function dayLabel(d) {
  return d.toLocaleDateString("en-US", { weekday: "short" }); // Mon, Tue...
}

function monthLabel(d) {
  return d.toLocaleDateString("en-US", { month: "short" }); // Jan, Feb...
}

// GET /dashboard/summary
exports.getDashboardSummary = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // optional query: ?days=7 or ?days=30 etc
    const days = clamp(req.query.days ?? 7, 1, 365);

    const now = new Date();
    const from = getStartOfDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
    const to = getEndOfDay(now);

    // We rely on your ChatSession.messages payloads:
    // - text-scan: payload.aiGenerated, payload.score
    // - link-check: payload.trustScore
    // - image-scan: payload.isDeepfake, payload.score
    //
    // We'll aggregate only assistant messages that have payload.
    const rows = await ChatSession.aggregate([
      {
        $match: {
          user: userId,
          updatedAt: { $gte: from, $lte: to },
        },
      },
      { $unwind: "$messages" },
      {
        $match: {
          "messages.role": "assistant",
          "messages.payload": { $exists: true, $ne: null },
          "messages.kind": { $in: ["text-scan", "link-check", "image-scan"] },
        },
      },
      {
        $project: {
          kind: "$messages.kind",
          payload: "$messages.payload",
          createdAt: "$messages.createdAt",
          fallbackCreatedAt: "$updatedAt",
        },
      },
      {
        $addFields: {
          ts: { $ifNull: ["$createdAt", "$fallbackCreatedAt"] },
        },
      },
    ]);

    // ---- Total scans (count of assistant payloads)
    const totalScans = rows.length;

    // ---- AI Content % (from text-scan payload.aiGenerated average)
    const textRows = rows.filter((r) => r.kind === "text-scan");
    const aiAvg =
      textRows.length > 0
        ? textRows.reduce((a, r) => a + clamp(r.payload?.aiGenerated ?? 0, 0, 100), 0) /
          textRows.length
        : 0;

    // ---- Link Risk % (treat low trustScore as "risk")
    // Define risk as trustScore < 60
    const linkRows = rows.filter((r) => r.kind === "link-check");
    const riskyLinks =
      linkRows.length > 0
        ? linkRows.filter((r) => clamp(r.payload?.trustScore ?? 0, 0, 100) < 60).length
        : 0;
    const linkRiskPct = linkRows.length > 0 ? (riskyLinks / linkRows.length) * 100 : 0;

    // ---- Alerts (count of notable issues)
    // Rules:
    // - text-scan: misinformation.detectedIssues length > 0
    // - link-check: trustScore < 60
    // - image-scan: isDeepfake true
    let alerts = 0;
    for (const r of rows) {
      if (r.kind === "text-scan") {
        const issues = r.payload?.misinformation?.detectedIssues;
        if (Array.isArray(issues) && issues.length > 0) alerts += 1;
      } else if (r.kind === "link-check") {
        if (clamp(r.payload?.trustScore ?? 0, 0, 100) < 60) alerts += 1;
      } else if (r.kind === "image-scan") {
        if (!!r.payload?.isDeepfake) alerts += 1;
      }
    }

    // ---- Weekly Scans (last 7 days always for chart)
    const daysList = last7Days();
    const buckets = new Map(daysList.map((d) => [getStartOfDay(d).toISOString(), 0]));

    for (const r of rows) {
      const d = getStartOfDay(r.ts || new Date());
      const key = d.toISOString();
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }

    const weeklyData = daysList.map((d) => ({
      day: dayLabel(d),
      scans: buckets.get(getStartOfDay(d).toISOString()) || 0,
    }));

    // ---- Trust Trend (last 6 months) using link-check trustScore avg per month
    const trustTrendMap = new Map(); // key: YYYY-MM
    const trustCountMap = new Map();
    for (const r of linkRows) {
      const dt = new Date(r.ts || new Date());
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      trustTrendMap.set(key, (trustTrendMap.get(key) || 0) + clamp(r.payload?.trustScore ?? 0, 0, 100));
      trustCountMap.set(key, (trustCountMap.get(key) || 0) + 1);
    }

    const trustTrendData = [];
    {
      const base = new Date();
      base.setDate(1);
      base.setHours(0, 0, 0, 0);
      // last 6 months including current
      for (let i = 5; i >= 0; i--) {
        const d = new Date(base);
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const sum = trustTrendMap.get(key) || 0;
        const cnt = trustCountMap.get(key) || 0;
        const avg = cnt ? sum / cnt : 0;
        trustTrendData.push({ month: monthLabel(d), score: Math.round(avg) });
      }
    }

    // ---- Authenticity Mix
    // Authentic = 100 - aiAvg (from text scans), AI-generated = aiAvg
    const authenticityMixData = [
      { name: "Authentic", value: Number((100 - aiAvg).toFixed(1)) },
      { name: "AI-Generated", value: Number(aiAvg.toFixed(1)) },
    ];

    return res.json({
      range: { from, to, days },
      stats: {
        totalScans,
        aiContentPct: Number(aiAvg.toFixed(1)),
        linkRiskPct: Number(linkRiskPct.toFixed(1)),
        alerts,
      },
      charts: {
        weeklyData,
        trustTrendData,
        authenticityMixData,
      },
    });
  } catch (e) {
    next(e);
  }
};