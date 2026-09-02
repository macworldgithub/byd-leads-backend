const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "sms_config" },
    username: { type: String, default: "" },
    apiKey: { type: String, default: "" },
    simulationMode: { type: Boolean, default: true },
    senderId: { type: String, default: "BYD-DIRECT" },
    connectionStatus: {
      type: String,
      enum: ["untested", "connected", "failed"],
      default: "untested",
    },
    lastTestedAt: { type: Date, default: null },
    connectionMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
