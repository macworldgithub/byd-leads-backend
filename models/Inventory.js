const mongoose = require("mongoose");

const inventorySchema = new mongoose.Schema(
  {
    stock: { type: String, required: true, unique: true },
    model: { type: String, default: "" },
    paint: { type: String, default: "" },
    location: { type: String, default: "" },
    status: { type: String, enum: ["Available", "In Transit", "Sold", "Unavailable"], default: "Available" },
    price: { type: String, default: "" },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Inventory", inventorySchema);
