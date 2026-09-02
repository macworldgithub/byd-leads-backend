const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    when: { type: String, required: true },
    prospectName: { type: String, required: true },
    phone: { type: String, default: "0491 570 204" },
    type: { type: String, enum: ["Test Drive", "Callback", "Showroom Visit"], default: "Test Drive" },
    vehicle: { type: String, default: "" },
    dealership: { type: String, default: "" },
    bookedBy: { type: String, enum: ["AI", "Agent", "Manual"], default: "AI" },
    status: {
      type: String,
      enum: ["Proposed", "Confirmed", "Completed", "Cancelled", "No Show"],
      default: "Confirmed",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
