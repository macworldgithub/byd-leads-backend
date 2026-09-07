const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");
const Conversation = require("../models/Conversation");

// GET all leads (with optional filters + pagination)
router.get("/", async (req, res) => {
  try {
    const { stage, dealer, tag, status, platform, q, page, limit, sort } = req.query;
    const filter = {};

    if (stage) filter.stage = stage;
    if (dealer) filter.dealer = { $regex: dealer, $options: "i" };
    if (tag) filter.tag = tag;
    if (status) filter.status = status;
    if (platform) filter.platform = platform;

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { vehicle: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { stockNum: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { dealer: { $regex: q, $options: "i" } },
        { leadSource: { $regex: q, $options: "i" } },
        { autogateId: { $regex: q, $options: "i" } },
      ];
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * pageSize;

    // Sort
    let sortObj = { createdAt: -1 };
    if (sort === "score") sortObj = { score: -1 };
    if (sort === "name") sortObj = { name: 1 };
    if (sort === "received") sortObj = { receivedDaysAgo: 1 };

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(sortObj).skip(skip).limit(pageSize),
      Lead.countDocuments(filter),
    ]);

    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET distinct dealerships (for filter dropdown)
router.get("/dealerships", async (req, res) => {
  try {
    const dealers = await Lead.distinct("dealer");
    res.json(dealers.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET distinct statuses (for filter dropdown)
router.get("/statuses", async (req, res) => {
  try {
    const statuses = await Lead.distinct("status");
    res.json(statuses.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET pipeline stats
router.get("/stats", async (req, res) => {
  try {
    const [total, humanAssisted, aiQualifying, testDrives] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ control: { $regex: "Human", $options: "i" } }),
      Lead.countDocuments({ stage: "AI QUALIFYING" }),
      Lead.countDocuments({ stage: "TEST DRIVE BOOKED" }),
    ]);
    res.json({ total, humanAssisted, aiQualifying, testDrives });
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

// DELETE lead (cascade removes corresponding Conversation too)
router.delete("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      // Also check if id refers to a Conversation or prospect by phone
      const deletedConvo = await Conversation.findOneAndDelete({
        $or: [
          { _id: req.params.id },
          { leadId: req.params.id },
          { manualProspectId: req.params.id },
        ],
      });
      if (deletedConvo) {
        return res.json({ message: "Lead conversation deleted" });
      }
      return res.status(404).json({ error: "Lead not found" });
    }

    // Delete lead and its associated conversation by leadId or phone
    await Promise.all([
      Lead.findByIdAndDelete(req.params.id),
      Conversation.deleteMany({
        $or: [
          { leadId: lead._id },
          { manualProspectId: lead._id.toString() },
          { phone: lead.phone },
        ],
      }),
    ]);

    res.json({ message: "Lead and related conversation deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
