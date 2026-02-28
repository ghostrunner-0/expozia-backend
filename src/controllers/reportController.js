// controllers/reportController.js
const ChatSession = require("../models/ChatSession");

function clamp(n, a, b) {
    n = Number(n);
    if (Number.isNaN(n)) return a;
    return Math.max(a, Math.min(b, n));
}

function periodToFrom(period) {
    const now = new Date();
    const d = new Date(now);

    if (period === "7d") d.setDate(d.getDate() - 7);
    else if (period === "30d") d.setDate(d.getDate() - 30);
    else if (period === "90d") d.setDate(d.getDate() - 90);
    else d.setDate(d.getDate() - 30);

    return d;
}

function getLastAssistantPayload(session) {
    const msgs = Array.isArray(session.messages) ? session.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant") return msgs[i]?.payload || null;
    }
    return null;
}

function getLastUserInput(session) {
    const msgs = Array.isArray(session.messages) ? session.messages : [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "user") return msgs[i]?.content || "";
    }
    return "";
}

// Result labeling rules for UI table + detection buckets
function classifyScan(kind, payload) {
    // Default output
    const out = {
        category: "Authentic", // Authentic | AI-Gen | Suspicious | Deepfake
        label: "Authentic",
        score: 0,
        risk: false,
    };

    if (!payload || typeof payload !== "object") {
        out.category = "Suspicious";
        out.label = "Risk Detected";
        out.score = 0;
        out.risk = true;
        return out;
    }

    if (kind === "image-scan") {
        const score = clamp(payload.score ?? 0, 0, 100);
        const isDeepfake = !!payload.isDeepfake;

        out.score = score;
        if (isDeepfake) {
            out.category = "Deepfake";
            out.label = "Deepfake";
            out.risk = true;
        } else {
            out.category = "Authentic";
            out.label = "Authentic";
            out.risk = false;
        }
        return out;
    }

    if (kind === "link-check") {
        const trustScore = clamp(payload.trustScore ?? 0, 0, 100);
        out.score = trustScore;

        if (trustScore >= 70) {
            out.category = "Authentic";
            out.label = "Trusted";
            out.risk = false;
        } else if (trustScore >= 40) {
            out.category = "Suspicious";
            out.label = "Mixed";
            out.risk = true;
        } else {
            out.category = "Suspicious";
            out.label = "Risk Detected";
            out.risk = true;
        }
        return out;
    }

    // text-scan
    const score = clamp(payload.score ?? 0, 0, 100);
    const aiGenerated = clamp(payload.aiGenerated ?? 0, 0, 100);

    out.score = score;

    if (aiGenerated >= 60) {
        out.category = "AI-Gen";
        out.label = "AI-Generated";
        out.risk = true;
    } else if (score < 40) {
        out.category = "Suspicious";
        out.label = "Suspicious";
        out.risk = true;
    } else {
        out.category = "Authentic";
        out.label = "Authentic";
        out.risk = false;
    }

    return out;
}

function bucketLabelForPeriod(period, date) {
    // For trends chart labels
    const d = new Date(date);

    if (period === "7d") {
        // Day labels
        return d.toLocaleDateString("en-US", { weekday: "short" }); // Mon, Tue...
    }

    if (period === "30d") {
        // Week label (Week 1..)
        // We'll calculate week index relative to range start in controller
        return null;
    }

    // 90d: month label
    return d.toLocaleDateString("en-US", { month: "short" }); // Jan, Feb...
}

function toISODate(d) {
    const x = new Date(d);
    return x.toISOString().slice(0, 10);
}

exports.getReportsSummary = async (req, res, next) => {
    try {
        const period = String(req.query.period || "30d");
        const from = periodToFrom(period);
        const userId = req.user._id;

        // Pull sessions in range (updatedAt is best for "activity")
        const sessions = await ChatSession.find({
            user: userId,
            updatedAt: { $gte: from },
            kind: { $in: ["text-scan", "image-scan", "link-check"] },
        })
            .sort({ updatedAt: -1 })
            .limit(500)
            .lean();

        const totalScans = sessions.length;

        // --- scansByType ---
        const byTypeMap = { Text: 0, Image: 0, Link: 0 };
        for (const s of sessions) {
            if (s.kind === "text-scan") byTypeMap.Text++;
            if (s.kind === "image-scan") byTypeMap.Image++;
            if (s.kind === "link-check") byTypeMap.Link++;
        }

        const scansByType = [
            { name: "Text", value: byTypeMap.Text, color: "#5BC0EB" },
            { name: "Image", value: byTypeMap.Image, color: "#6FCFE9" },
            { name: "Link", value: byTypeMap.Link, color: "#85D9F0" },
        ];

        // --- avg score + risk ---
        let scoreSum = 0;
        let scoreCount = 0;
        let riskCount = 0;

        // detection buckets
        const detection = {
            Authentic: 0,
            "AI-Gen": 0,
            Suspicious: 0,
            Deepfake: 0,
        };

        // processing time avg (optional if you store durationMs somewhere)
        let timeSumMs = 0;
        let timeCount = 0;

        // recent scans table
        const recentScans = [];

        for (const s of sessions) {
            const payload = getLastAssistantPayload(s);
            const input = getLastUserInput(s);

            const type = s.kind === "text-scan" ? "Text" : s.kind === "image-scan" ? "Image" : "Link";
            const cls = classifyScan(s.kind, payload);

            detection[cls.category] = (detection[cls.category] || 0) + 1;
            if (cls.risk) riskCount++;

            // avg score
            scoreSum += cls.score;
            scoreCount++;

            // avg processing time (if you ever add payload.durationMs)
            const durationMs = Number(payload?.durationMs);
            if (!Number.isNaN(durationMs) && durationMs > 0) {
                timeSumMs += durationMs;
                timeCount++;
            }

            // build recent table rows (top 10)
            if (recentScans.length < 10) {
                recentScans.push({
                    type,
                    url: type === "Image" ? "image-upload" : String(input || "").slice(0, 120),
                    result: cls.label,
                    score: cls.score,
                    date: toISODate(s.updatedAt || s.createdAt),
                });
            }
        }

        const avgScore = scoreCount ? Number((scoreSum / scoreCount).toFixed(1)) : 0;
        const riskDetectedPct = totalScans ? Number(((riskCount / totalScans) * 100).toFixed(1)) : 0;

        // --- trendsData ---
        // We will bucket differently by period:
        // 7d: by weekday
        // 30d: Week 1..Week 4/5
        // 90d: by month
        const trendsMap = new Map(); // label => count

        if (period === "30d") {
            // Week buckets from 'from'
            for (const s of sessions) {
                const dt = new Date(s.updatedAt || s.createdAt);
                const diffDays = Math.floor((dt - from) / (1000 * 60 * 60 * 24));
                const weekIndex = clamp(Math.floor(diffDays / 7) + 1, 1, 6); // Week 1..6
                const label = `Week ${weekIndex}`;
                trendsMap.set(label, (trendsMap.get(label) || 0) + 1);
            }

            const trendsData = [];
            for (let w = 1; w <= 6; w++) {
                const label = `Week ${w}`;
                if (trendsMap.has(label)) trendsData.push({ date: label, scans: trendsMap.get(label) });
            }

            const detectionData = [
                { category: "Authentic", count: detection.Authentic },
                { category: "AI-Gen", count: detection["AI-Gen"] },
                { category: "Suspicious", count: detection.Suspicious },
                { category: "Deepfake", count: detection.Deepfake },
            ];

            const processingTime =
                timeCount > 0 ? `${(timeSumMs / timeCount / 1000).toFixed(1)}s` : "N/A";

            return res.json({
                kpis: {
                    totalScans,
                    avgScore,
                    riskDetectedPct,
                    processingTime,
                },
                scansByType,
                trendsData,
                detectionData,
                recentScans,
            });
        }

        if (period === "90d") {
            for (const s of sessions) {
                const dt = new Date(s.updatedAt || s.createdAt);
                const label = bucketLabelForPeriod("90d", dt); // Jan/Feb...
                trendsMap.set(label, (trendsMap.get(label) || 0) + 1);
            }

            // keep last 6 months-ish ordering based on date appearance in sessions
            const order = [];
            for (const s of [...sessions].reverse()) {
                const dt = new Date(s.updatedAt || s.createdAt);
                const label = bucketLabelForPeriod("90d", dt);
                if (!order.includes(label)) order.push(label);
            }

            const trendsData = order.map((label) => ({ date: label, scans: trendsMap.get(label) || 0 }));

            const detectionData = [
                { category: "Authentic", count: detection.Authentic },
                { category: "AI-Gen", count: detection["AI-Gen"] },
                { category: "Suspicious", count: detection.Suspicious },
                { category: "Deepfake", count: detection.Deepfake },
            ];

            const processingTime =
                timeCount > 0 ? `${(timeSumMs / timeCount / 1000).toFixed(1)}s` : "N/A";

            return res.json({
                kpis: {
                    totalScans,
                    avgScore,
                    riskDetectedPct,
                    processingTime,
                },
                scansByType,
                trendsData,
                detectionData,
                recentScans,
            });
        }

        // default 7d
        for (const s of sessions) {
            const dt = new Date(s.updatedAt || s.createdAt);
            const label = bucketLabelForPeriod("7d", dt); // Mon Tue
            trendsMap.set(label, (trendsMap.get(label) || 0) + 1);
        }

        const weekOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const trendsData = weekOrder.map((day) => ({ date: day, scans: trendsMap.get(day) || 0 }));

        const detectionData = [
            { category: "Authentic", count: detection.Authentic },
            { category: "AI-Gen", count: detection["AI-Gen"] },
            { category: "Suspicious", count: detection.Suspicious },
            { category: "Deepfake", count: detection.Deepfake },
        ];

        const processingTime =
            timeCount > 0 ? `${(timeSumMs / timeCount / 1000).toFixed(1)}s` : "N/A";

        return res.json({
            kpis: {
                totalScans,
                avgScore,
                riskDetectedPct,
                processingTime,
            },
            scansByType,
            trendsData,
            detectionData,
            recentScans,
        });
    } catch (e) {
        next(e);
    }
};