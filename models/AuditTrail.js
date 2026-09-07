const mongoose = require("mongoose");

const auditTrailSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    actor: { type: String, default: "System" },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditTrail", auditTrailSchema);
