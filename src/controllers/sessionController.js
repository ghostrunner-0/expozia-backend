const ChatSession = require("../models/ChatSession");

exports.listSessions = async (req, res, next) => {
  try {
    const { kind } = req.query;
    const q = { user: req.user._id };
    if (kind) q.kind = kind;

    const sessions = await ChatSession.find(q)
      .select("_id kind title updatedAt createdAt")
      .sort({ updatedAt: -1 })
      .limit(50);

    res.json({ sessions });
  } catch (e) {
    next(e);
  }
};

exports.getSession = async (req, res, next) => {
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, user: req.user._id });
    if (!session) return res.status(404).json({ message: "Session not found" });
    res.json({ session });
  } catch (e) {
    next(e);
  }
};

exports.newSession = async (req, res, next) => {
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
  } catch (e) {
    next(e);
  }
};