// src/utils/safeJson.js
function safeExtractJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini did not return JSON");

  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error("Gemini returned invalid JSON");
  }
}

module.exports = { safeExtractJson };