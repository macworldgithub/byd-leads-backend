const express = require("express");
const router = express.Router();
const Dealership = require("../models/Dealership");

// GET all dealerships
router.get("/", async (req, res) => {
  try {
    const dealerships = await Dealership.find().sort({ name: 1 });
    res.json(dealerships);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single dealership by id
router.get("/:id", async (req, res) => {
  try {
    const d = await Dealership.findById(req.params.id);
    if (!d) return res.status(404).json({ error: "Dealership not found" });
    res.json(d);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create dealership
router.post("/", async (req, res) => {
  try {
    const d = await Dealership.create(req.body);
    res.status(201).json(d);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update dealership
router.put("/:id", async (req, res) => {
  try {
    const d = await Dealership.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!d) return res.status(404).json({ error: "Dealership not found" });
    res.json(d);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE dealership
router.delete("/:id", async (req, res) => {
  try {
    const d = await Dealership.findByIdAndDelete(req.params.id);
    if (!d) return res.status(404).json({ error: "Dealership not found" });
    res.json({ message: "Dealership deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
