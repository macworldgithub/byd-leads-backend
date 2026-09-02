const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  direction: { type: String, enum: ["inbound", "outbound"], default: "outbound" },
  text: { type: String, required: true },
  sentAt: { type: Date, default: Date.now },
});

const conversationSchema = new mongoose.Schema(
  {
    prospectName: { type: String, required: true },
    phone: { type: String, default: "" },
    initials: { type: String, default: "" },
    dealer: { type: String, default: "" },
    status: { type: String, enum: ["Contact", "Commitment"], default: "Contact" },
    control: { type: String, default: "AI active" },
    messages: [messageSchema],
    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
    msgCount: { type: Number, default: 0 },
    daysAgo: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
