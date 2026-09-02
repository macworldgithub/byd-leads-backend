const express = require("express");
const router = express.Router();
const Inventory = require("../models/Inventory");

// GET all inventory (with optional filters)
router.get("/", async (req, res) => {
  try {
    const { model, status, location, q } = req.query;
    const filter = {};
    if (model) filter.model = { $regex: model, $options: "i" };
    if (status) filter.status = status;
    if (location) filter.location = { $regex: location, $options: "i" };
    if (q) {
      filter.$or = [
        { stock: { $regex: q, $options: "i" } },
        { model: { $regex: q, $options: "i" } },
        { paint: { $regex: q, $options: "i" } },
      ];
    }
    const items = await Inventory.find(filter).sort({ stock: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create inventory item
router.post("/", async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update inventory item
router.put("/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ error: "Inventory item not found" });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
