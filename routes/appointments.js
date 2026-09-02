const express = require("express");
const router = express.Router();
const Appointment = require("../models/Appointment");

// GET all appointments
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const appts = await Appointment.find(filter).sort({ createdAt: 1 });
    res.json(appts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single appointment
router.get("/:id", async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create appointment
router.post("/", async (req, res) => {
  try {
    const appt = await Appointment.create(req.body);
    res.status(201).json(appt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update appointment (especially status)
router.put("/:id", async (req, res) => {
  try {
    const appt = await Appointment.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json(appt);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE appointment
router.delete("/:id", async (req, res) => {
  try {
    const appt = await Appointment.findByIdAndDelete(req.params.id);
    if (!appt) return res.status(404).json({ error: "Appointment not found" });
    res.json({ message: "Appointment deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
