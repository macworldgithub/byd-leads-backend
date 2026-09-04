const mongoose = require("mongoose");

const auditTrailSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    actor: { type: String, required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditTrail", auditTrailSchema);
