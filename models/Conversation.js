const mongoose = require("mongoose");

const conversationMessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  sender: {
    type: String,
    enum: ["ai", "user", "agent", "system"],
    required: true,
  },
  text: { type: String, required: true },
  time: { type: String, default: "" },
  status: { type: String, default: "sent" },
  createdAt: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      required: false,
    },
    manualProspectId: { type: String, default: "" },
    prospectName: { type: String, required: true },
    phone: { type: String, default: "" },
    initials: { type: String, default: "" },
    dealer: { type: String, default: "" },
    status: { type: String, default: "Contact" },
    control: {
      type: String,
      default: "AI active",
    },
    suggestedResponses: [
      {
        type: String,
      },
    ],
    qualification: {
      intent: { type: String, default: "—" },
      budget: { type: String, default: "—" },
      timeline: { type: String, default: "—" },
      tradeIn: { type: String, default: "—" },
      finance: { type: String, default: "—" },
    },
    messages: [conversationMessageSchema],
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
    msgCount: { type: Number, default: 0 },
    daysAgo: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
