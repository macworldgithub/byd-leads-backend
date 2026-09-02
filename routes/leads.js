const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");

// GET all leads (with optional filters)
router.get("/", async (req, res) => {
  try {
    const { stage, dealer, tag, q } = req.query;
    const filter = {};
    if (stage) filter.stage = stage;
    if (dealer) filter.dealer = dealer;
    if (tag) filter.tag = tag;
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { vehicle: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { stockNum: { $regex: q, $options: "i" } },
      ];
    }
    const leads = await Lead.find(filter).sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single lead
router.get("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create lead
router.post("/", async (req, res) => {
  try {
    const lead = await Lead.create(req.body);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update lead
router.put("/:id", async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE lead
router.delete("/:id", async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json({ message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
