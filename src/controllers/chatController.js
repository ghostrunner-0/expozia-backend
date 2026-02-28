// controllers/chatController.js
const { geminiText } = require("../services/gemini");
function safeJson(v, max = 12000) {
  try {
    const s = JSON.stringify(v ?? null, null, 2);
    return s.length > max ? s.slice(0, max) + "\n...<truncated>" : s;
  } catch {
    return "{}";
  }
}

function buildDashboardChatPrompt({ message, context }) {
  const ctx = context && typeof context === "object" ? context : {};
  const currentPage = String(ctx.currentPage || "Dashboard");
  const appOverview = String(
    ctx.appOverview ||
      `
EXPOZIA Dashboard:
- TextScan: analyze text for authenticity, AI-generated sections, and misinformation.
- LinkCheck: analyze a URL for trust score, SSL, reputation, blacklist signals.
- ImageScan: analyze an image for deepfake signals + extracted text corrections.
- Sessions/History: stores scans per user.

You are the in-app assistant for this dashboard.
`.trim()
  );

  // optional hints from UI
  const uiState = ctx.uiState ?? {};
  const lastScan = ctx.lastScan ?? null;

  return `
You are EXPOZIA AI — the in-app assistant for the EXPOZIA dashboard.

GOALS:
- Help the user understand and use the dashboard.
- Explain scan results if provided.
- Help troubleshoot UI/backend issues (API routes, payloads, errors).
- If asked general questions, answer normally and briefly.

IMPORTANT RULES:
- If you reference scan results, ONLY use "lastScan" provided below.
- If a user asks for risky instructions (hacking, bypassing security, etc), refuse and suggest safe alternatives.
- Keep answers practical, short-to-medium, and step-by-step when needed.

CONTEXT:
currentPage: ${currentPage}

appOverview:
${appOverview}

uiState (JSON):
${safeJson(uiState)}

lastScan (JSON):
${safeJson(lastScan)}

USER MESSAGE:
"""${String(message || "").slice(0, 4000)}"""
`.trim();
}

exports.askDashboardAssistant = async (req, res, next) => {
  try {
    const { message, context } = req.body || {};
    if (!message || String(message).trim().length < 1) {
      return res.status(400).json({ message: "Message is required" });
    }

    const prompt = buildDashboardChatPrompt({ message, context });
    const reply = await geminiText(prompt);

    return res.json({
      reply: reply?.trim?.() || "I couldn’t generate a reply. Try again.",
    });
  } catch (e) {
    next(e);
  }
};