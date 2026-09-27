const express = require("express");
const router = express.Router();
const Appointment = require("../models/Appointment");

// GET all appointments with pagination & location/yard filtering
router.get("/", async (req, res) => {
  try {
    const { status, type, location, yard, dealership, site, q, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status && status !== "All") {
      filter.status = status;
    }

    if (type && type !== "All") {
      filter.type = type;
    }

    const locVal = location || yard || dealership || site;
    if (locVal && locVal !== "All" && locVal !== "All Locations" && locVal !== "All Yards" && locVal !== "All Sites") {
      filter.$or = [
        { dealership: { $regex: locVal, $options: "i" } },
        { location: { $regex: locVal, $options: "i" } },
        { site: { $regex: locVal, $options: "i" } },
        { yard: { $regex: locVal, $options: "i" } },
        { "vehicle.yard": { $regex: locVal, $options: "i" } },
      ];
    }

    if (q && q.trim()) {
      const qRegex = { $regex: q.trim(), $options: "i" };
      const searchConditions = [
        { prospectName: qRegex },
        { phone: qRegex },
        { email: qRegex },
        { vehicle: qRegex },
        { "vehicle.raw": qRegex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const skip = (pageNum - 1) * limitNum;

    const [appts, total] = await Promise.all([
      Appointment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Appointment.countDocuments(filter),
    ]);

    const pages = Math.ceil(total / limitNum) || 1;

    // Check if client expects raw array
    if (req.query.raw === "true") {
      return res.json(appts);
    }

    res.json({
      success: true,
      data: appts,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages,
      },
    });
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
