const express = require("express");
const router = express.Router();
const AuditTrail = require("../models/AuditTrail");

// GET all audit trails sorted by createdAt desc
router.get("/", async (req, res) => {
  try {
    const trails = await AuditTrail.find().sort({ createdAt: -1 });
    res.json(trails);
  } catch (err) {
    console.error("Error fetching audit trails:", err);
    res.status(500).json({ error: "Failed to fetch audit trails" });
  }
});

module.exports = router;
