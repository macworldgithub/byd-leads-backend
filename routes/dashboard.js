const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");
const Appointment = require("../models/Appointment");
const Conversation = require("../models/Conversation");

// GET /api/dashboard — aggregated stats for the dashboard page
router.get("/", async (req, res) => {
  try {
    const [
      totalLeads,
      aiQualifying,
      testDriveBooked,
      humanAssisted,
      appointments,
      conversationCount,
      recentLeads,
    ] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ stage: "AI QUALIFYING" }),
      Lead.countDocuments({ stage: "TEST DRIVE BOOKED" }),
      Lead.countDocuments({ control: { $regex: "Human", $options: "i" } }),
      Appointment.countDocuments({ status: "Confirmed" }),
      Conversation.countDocuments(),
      Lead.find().sort({ createdAt: -1 }).limit(4),
    ]);

    // Funnel counts
    const imported = totalLeads;
    const engaged = await Lead.countDocuments({
      stage: { $in: ["AI QUALIFYING", "TEST DRIVE BOOKED"] },
    });
    const qualified = await Lead.countDocuments({
      stage: { $in: ["AI QUALIFYING", "TEST DRIVE BOOKED"] },
      score: { $gte: 60 },
    });
    const committed = testDriveBooked;

    res.json({
      stats: {
        activeJourneys: totalLeads,
        appointments,
        conversationActivity: conversationCount,
        humanAssisted,
      },
      funnel: {
        imported,
        engaged,
        qualified,
        committed,
      },
      recentLeads,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
