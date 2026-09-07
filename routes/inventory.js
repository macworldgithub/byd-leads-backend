const express = require("express");
const router = express.Router();
const Inventory = require("../models/Inventory");

// GET all inventory (with optional filters)
router.get("/", async (req, res) => {
  try {
    const { model, status, location, condition, platform, q } = req.query;
    const filter = {};

    if (model) {
      filter.$or = filter.$or || [];
      filter.model = { $regex: model, $options: "i" };
    }
    if (status) filter.status = status;
    if (location) filter.location = { $regex: location, $options: "i" };
    if (condition) filter.condition = condition;
    if (platform) filter.platform = platform;

    if (q) {
      filter.$or = [
        { stock: { $regex: q, $options: "i" } },
        { model: { $regex: q, $options: "i" } },
        { paint: { $regex: q, $options: "i" } },
        { title: { $regex: q, $options: "i" } },
        { identifier: { $regex: q, $options: "i" } },
        { networkId: { $regex: q, $options: "i" } },
        { "specifications.model": { $regex: q, $options: "i" } },
        { "specifications.colour": { $regex: q, $options: "i" } },
        { "specifications.manufacturerColour": { $regex: q, $options: "i" } },
        { "registration.rego": { $regex: q, $options: "i" } },
        { "registration.vin": { $regex: q, $options: "i" } },
      ];
    }

    const isPaginated = paginated === "true" || (page !== undefined && page !== "");
    if (isPaginated) {
      const pageNum = Math.max(1, parseInt(page) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(limit) || 50));
      const skip = (pageNum - 1) * pageSize;

      const [items, total] = await Promise.all([
        Inventory.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(pageSize),
        Inventory.countDocuments(filter),
      ]);

      return res.json({
        data: items,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / pageSize) || 1,
        limit: pageSize,
      });
    }

    const items = await Inventory.find(filter).sort({ updatedAt: -1 });
    res.setHeader("X-Total-Count", items.length);
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
