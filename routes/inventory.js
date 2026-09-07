const express = require("express");
const router = express.Router();
const Inventory = require("../models/Inventory");

// Helper to escape regex special characters
function escapeRegex(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET all inventory (with optional filters)
router.get("/", async (req, res) => {
  try {
    const { model, status, location, condition, platform, q, page, limit, paginated } = req.query;
    const filter = {};

    if (model) filter.model = { $regex: escapeRegex(model), $options: "i" };
    if (status) filter.status = status;
    if (location) filter.location = { $regex: escapeRegex(location), $options: "i" };
    if (condition) filter.condition = condition;
    if (platform) filter.platform = platform;

    if (q) {
      const safeQ = escapeRegex(q);
      filter.$or = [
        { stock: { $regex: safeQ, $options: "i" } },
        { model: { $regex: safeQ, $options: "i" } },
        { paint: { $regex: safeQ, $options: "i" } },
        { title: { $regex: safeQ, $options: "i" } },
        { identifier: { $regex: safeQ, $options: "i" } },
        { networkId: { $regex: safeQ, $options: "i" } },
        { "specifications.model": { $regex: safeQ, $options: "i" } },
        { "specifications.colour": { $regex: safeQ, $options: "i" } },
        { "specifications.manufacturerColour": { $regex: safeQ, $options: "i" } },
        { "registration.rego": { $regex: safeQ, $options: "i" } },
        { "registration.vin": { $regex: safeQ, $options: "i" } },
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
