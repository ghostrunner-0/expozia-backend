const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true }, // user input or assistant summary
    payload: { type: mongoose.Schema.Types.Mixed }, // results JSON
    kind: { type: String, enum: ["text-scan", "image-scan", "link-check"], required: true },
  },
  { timestamps: true }
);

const ChatSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["text-scan", "image-scan", "link-check"], required: true },
    title: { type: String, default: "" },
    messages: { type: [MessageSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ChatSession", ChatSessionSchema);