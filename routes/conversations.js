const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");

// GET all conversations (with optional filter/search)
router.get("/", async (req, res) => {
  try {
    const { control, q } = req.query;
    const filter = {};
    if (control === "ai") filter.control = "AI active";
    if (control === "human") filter.control = { $regex: "Human", $options: "i" };
    if (q) {
      filter.$or = [
        { prospectName: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
      ];
    }
    const convos = await Conversation.find(filter).sort({ lastMessageAt: -1 });
    res.json(convos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single conversation
router.get("/:id", async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create conversation
router.post("/", async (req, res) => {
  try {
    const convo = await Conversation.create(req.body);
    res.status(201).json(convo);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
