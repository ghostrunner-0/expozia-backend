// src/controllers/scanController.js
const validator = require("validator");
const multer = require("multer");
const ChatSession = require("../models/ChatSession");
const { clamp } = require("../utils/clamp");
const { geminiJsonText, geminiJsonVision } = require("../services/gemini");
const { URL } = require("url");

// multer memory storage for image upload
const upload = multer({ storage: multer.memoryStorage() });
exports.uploadImage = upload.single("image");

// ---------------- PROMPTS ----------------
function buildTextScanPrompt(text) {
  return `
You are an analysis engine for authenticity + misinformation detection.
Return STRICT JSON ONLY:

{
  "score": number (0-100),
  "aiGenerated": number (0-100),
  "detectedSections": [{"start": number, "end": number, "confidence": number}],
  "misinformation": {
    "overallConfidence": number (0-100),
    "detectedIssues": [
      {
        "text": string,
        "position": {"start": number, "end": number},
        "confidence": number (0-100),
        "suggestion": string
      }
    ]
  },
  "assistantSummary": string
}

Rules:
- start/end are character indices in the input text.
- If no issues: detectedSections=[], misinformation.detectedIssues=[].
- assistantSummary 1-3 sentences.

TEXT:
"""${text}"""
`;
}

function buildLinkPrompt(url) {
  return `
You are a link credibility checker.
Return STRICT JSON ONLY:

{
  "trustScore": number (0-100),
  "domain": string,
  "analysis": {
    "domainAuthority": {"score": number, "status": "Low"|"Medium"|"High", "details": string},
    "httpsSSL": {"score": number, "status": "Insecure"|"Secure", "details": string},
    "blacklistStatus": {"score": number, "status": "Clean"|"Suspicious", "details": string},
    "reputation": {"score": number, "status": "Untrusted"|"Mixed"|"Trusted", "details": string}
  },
  "factChecks": [string],
  "assistantSummary": string
}

Focus on:
- phishing risk signals
- suspicious redirects / typosquatting
- user safety tips

URL: "${url}"
`;
}

function buildImagePrompt() {
  return `
You analyze an image for manipulation/deepfake and extract visible text then correct misinformation.
Return STRICT JSON ONLY:

{
  "score": number (0-100),
  "isDeepfake": boolean,
  "metadata": {
    "resolution": string,
    "format": string,
    "created": string,
    "camera": string
  },
  "signals": [{"type": string, "status": "Pass"|"Warn"|"Fail", "confidence": number}],
  "extractedText": {
    "raw": string,
    "corrections": [
      {
        "original": string,
        "corrected": string,
        "position": {"start": number, "end": number},
        "confidence": number (0-100)
      }
    ]
  },
  "assistantSummary": string
}

Notes:
- If unknown metadata, use "Unknown".
- Positions are for extractedText.raw (character offsets).
`;
}

// ---------------- SESSION SAVE ----------------
async function upsertSessionAndSave(userId, kind, userInput, assistantPayload) {
  let session = await ChatSession.findOne({ user: userId, kind }).sort({ updatedAt: -1 });

  if (!session) {
    session = await ChatSession.create({
      user: userId,
      kind,
      title: kind === "text-scan" ? "Text Scan" : kind === "image-scan" ? "Image Scan" : "Link Check",
      messages: [],
    });
  }

  session.messages.push({
    role: "user",
    content: userInput,
    kind,
  });

  session.messages.push({
    role: "assistant",
    content: assistantPayload.assistantSummary || "Analysis complete.",
    payload: assistantPayload,
    kind,
  });

  await session.save();
  return session;
}

// ---------------- TEXT SCAN ----------------
exports.textScan = async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || String(text).trim().length < 5) {
      return res.status(400).json({ message: "Text is too short" });
    }

    const data = await geminiJsonText(buildTextScanPrompt(text));

    data.score = clamp(data.score, 0, 100);
    data.aiGenerated = clamp(data.aiGenerated, 0, 100);

    // defaults (so UI never breaks)
    if (!Array.isArray(data.detectedSections)) data.detectedSections = [];
    if (!data.misinformation) data.misinformation = { overallConfidence: 0, detectedIssues: [] };
    if (!Array.isArray(data.misinformation.detectedIssues)) data.misinformation.detectedIssues = [];

    const session = await upsertSessionAndSave(req.user._id, "text-scan", text, data);

    // return direct shape (UI expects score, aiGenerated etc.)
    return res.json({ sessionId: session._id, ...data });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Text scan failed" });
  }
};

// ---------------- LINK HELPERS ----------------
function basicUrlSignals(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, message: "Invalid URL" };
  }

  const host = u.hostname || "";
  const https = u.protocol === "https:";

  const looksLikeIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const hasPunycode = host.includes("xn--");

  return { ok: true, host, https, looksLikeIp, hasPunycode };
}

// ---------------- LINK CHECK ----------------
exports.linkCheck = async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !validator.isURL(String(url), { require_protocol: true })) {
      return res.status(400).json({ message: "Invalid URL (include https://)" });
    }

    const sig = basicUrlSignals(url);
    if (!sig.ok) return res.status(400).json({ message: sig.message });

    const data = await geminiJsonText(buildLinkPrompt(url));

    // penalties
    let penalty = 0;
    if (!sig.https) penalty += 12;
    if (sig.looksLikeIp) penalty += 15;
    if (sig.hasPunycode) penalty += 12;

    data.trustScore = clamp((data.trustScore ?? 0) - penalty, 0, 100);
    data.domain = data.domain || sig.host;

    if (!data.analysis || typeof data.analysis !== "object") data.analysis = {};
    if (!Array.isArray(data.factChecks)) data.factChecks = [];

    const session = await upsertSessionAndSave(req.user._id, "link-check", url, data);

    return res.json({ sessionId: session._id, ...data });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Link check failed" });
  }
};

// ---------------- IMAGE SCAN ----------------
exports.imageScan = async (req, res) => {
  try {
    const file = req.file; // multer attaches this

    if (!file) {
      return res.status(400).json({ message: "Image is required (field: image)" });
    }

    const mimeType = file.mimetype || "image/jpeg";
    const base64 = file.buffer.toString("base64");

    const data = await geminiJsonVision(buildImagePrompt(), mimeType, base64);

    data.score = clamp(data.score, 0, 100);
    data.isDeepfake = !!data.isDeepfake;

    // defaults
    if (!data.metadata || typeof data.metadata !== "object") {
      data.metadata = {
        resolution: "Unknown",
        format: "Unknown",
        created: "Unknown",
        camera: "Unknown",
      };
    }
    if (!Array.isArray(data.signals)) data.signals = [];
    if (!data.extractedText) data.extractedText = { raw: "", corrections: [] };
    if (!Array.isArray(data.extractedText.corrections)) data.extractedText.corrections = [];

    const session = await upsertSessionAndSave(req.user._id, "image-scan", "[image]", data);

    return res.json({ sessionId: session._id, ...data });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Image scan failed" });
  }
};

// ---------------- CHAT HISTORY ----------------
exports.listSessions = async (req, res) => {
  try {
    const { kind } = req.query; // optional
    const q = { user: req.user._id };
    if (kind) q.kind = kind;

    const sessions = await ChatSession.find(q)
      .select("_id kind title updatedAt createdAt")
      .sort({ updatedAt: -1 })
      .limit(50);

    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to list sessions" });
  }
};

exports.getSession = async (req, res) => {
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, user: req.user._id });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to fetch session" });
  }
};

exports.newSession = async (req, res) => {
  try {
    const { kind } = req.body;

    if (!["text-scan", "image-scan", "link-check"].includes(kind)) {
      return res.status(400).json({ message: "Invalid kind" });
    }

    const session = await ChatSession.create({
      user: req.user._id,
      kind,
      title: kind === "text-scan" ? "Text Scan" : kind === "image-scan" ? "Image Scan" : "Link Check",
      messages: [],
    });

    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to create session" });
  }
};