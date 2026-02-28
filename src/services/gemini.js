// src/services/gemini.js
const { GoogleGenAI } = require("@google/genai");
const { safeExtractJson } = require("../utils/safeJson");

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) console.warn("⚠️ GEMINI_API_KEY missing in .env");

const ai = new GoogleGenAI({ apiKey });

// pick models
const TEXT_MODEL = "gemini-3-flash-preview";
const VISION_MODEL = "gemini-3-flash-preview";

/**
 * ✅ Normal TEXT response from Gemini (for chatbot)
 */
async function geminiText(prompt) {
  const resp = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  // depending on SDK version, response text may be here:
  // - resp.text
  // - resp.response.text()
  // We'll safely handle both.
  if (typeof resp?.text === "string") return resp.text;

  const t = resp?.response?.text?.();
  if (typeof t === "string") return t;

  return "";
}

/**
 * Text-only JSON response from Gemini (for scans)
 */
async function geminiJsonText(prompt) {
  const resp = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const out =
    (typeof resp?.text === "string" && resp.text) ||
    (typeof resp?.response?.text?.() === "string" && resp.response.text()) ||
    "";

  return safeExtractJson(out);
}

/**
 * Vision + JSON response from Gemini (for image scan)
 */
async function geminiJsonVision(prompt, mimeType, base64) {
  const resp = await ai.models.generateContent({
    model: VISION_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
      },
    ],
  });

  const out =
    (typeof resp?.text === "string" && resp.text) ||
    (typeof resp?.response?.text?.() === "string" && resp.response.text()) ||
    "";

  return safeExtractJson(out);
}

module.exports = { geminiText, geminiJsonText, geminiJsonVision };