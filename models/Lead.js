const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    vehicle: { type: String, default: "" },
    dealer: { type: String, default: "" },
    score: { type: Number, default: 0, min: 0, max: 100 },
    tag: { type: String, enum: ["Contact", "Commitment", "Human assisted", "AI active"], default: "Contact" },
    color: { type: String, enum: ["blue", "green", "amber", "red"], default: "blue" },
    stage: {
      type: String,
      enum: ["NEW ENQUIRIES", "AI QUALIFYING", "TEST DRIVE BOOKED"],
      default: "NEW ENQUIRIES",
    },
    source: { type: String, default: "SMS Connect" },
    phone: { type: String, default: "" },
    stockNum: { type: String, default: "" },
    control: { type: String, default: "AI active" },
    receivedDaysAgo: { type: Number, default: 0 },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lead", leadSchema);
