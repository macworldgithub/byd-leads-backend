const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "sms_config" },
    username: { type: String, default: "" },
    apiKey: { type: String, default: "" },
    simulationMode: { type: Boolean, default: false },
    senderId: { type: String, default: "+61468104118" },
    connectionStatus: {
      type: String,
      enum: ["untested", "connected", "failed"],
      default: "untested",
    },
    lastTestedAt: { type: Date, default: null },
    connectionMessage: { type: String, default: "" },
    creditBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Setting", settingSchema);
