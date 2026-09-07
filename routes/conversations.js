const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");
const Lead = require("../models/Lead");

function formatTime(date = new Date()) {
  const day = date.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  let hours = date.getHours();
  const mins = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  return `${day} ${month}, ${hours}:${mins} ${ampm}`;
}

const DEFAULT_SUGGESTIONS = [
  "I'm looking to buy this month",
  "My budget is around $60k",
  "I have a vehicle to trade",
];

const SECONDARY_SUGGESTIONS = [
  "Yes, please call me at 3:30pm",
  "Can we also compare finance options?",
  "I'll bring my trade-in",
];

async function findOrCreateConversation(query) {
  const { leadId, manualProspectId, prospectName, phone, dealer, vehicle } = query;
  let convo = null;

  if (leadId) {
    convo = await Conversation.findOne({ leadId });
  }
  if (!convo && manualProspectId) {
    convo = await Conversation.findOne({ manualProspectId });
  }
  if (!convo && phone) {
    convo = await Conversation.findOne({ phone });
  }

  if (!convo) {
    const firstName = prospectName ? prospectName.split(" ")[0] : "Customer";
    const car = vehicle || "2025 BYD ATTO 1";
    const dealership = dealer || "BYD Fairfield VIC";
    const now = new Date();

    convo = await Conversation.create({
      leadId: leadId || undefined,
      manualProspectId: manualProspectId || "",
      prospectName: prospectName || "Customer",
      phone: phone || "",
      initials: (prospectName || "CU")
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      dealer: dealership,
      status: "Contact",
      control: "AI active",
      suggestedResponses: DEFAULT_SUGGESTIONS,
      qualification: {
        intent: "—",
        budget: "—",
        timeline: "—",
        tradeIn: "—",
        finance: "—",
      },
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: "ai",
          text: `Hi ${firstName}, thanks for your enquiry on the ${car} with ${dealership}. I'm the virtual assistant for our sales team — happy to answer questions or set up a test drive. When are you looking to get into a new car? Reply STOP to opt out`,
          time: `AI Assistant · ${formatTime(now)} · sent`,
          status: "sent",
        },
      ],
      lastMessage: `Hi ${firstName}, thanks for your enquiry...`,
      lastMessageAt: now,
      msgCount: 1,
      daysAgo: 0,
    });
  }

  return convo;
}

// Helper to escape regex special characters
function escapeRegex(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET all conversations (synchronized with existing leads)
router.get("/", async (req, res) => {
  try {
    const { control, q } = req.query;
    const filter = {};
    if (control === "ai") filter.control = "AI active";
    if (control === "human") filter.control = { $regex: "Human", $options: "i" };
    if (q) {
      const safeQ = escapeRegex(q);
      filter.$or = [
        { prospectName: { $regex: safeQ, $options: "i" } },
        { phone: { $regex: safeQ, $options: "i" } },
      ];
    }

    // Only return conversations that correspond to active leads or manual test leads
    const allLeads = await Lead.find({}, "_id phone");
    const activeLeadIds = new Set(allLeads.map((l) => l._id.toString()));
    const activeLeadPhones = new Set(allLeads.map((l) => l.phone).filter(Boolean));

    const convos = await Conversation.find(filter).sort({ lastMessageAt: -1 });

    // Filter out orphaned conversations where lead has been deleted
    const syncedConvos = convos.filter((c) => {
      // If it has a leadId, it must exist in active leads
      if (c.leadId) {
        return activeLeadIds.has(c.leadId.toString());
      }
      // If manual prospect with phone, check if lead with phone still exists or it's an explicit manual test
      if (c.phone && activeLeadPhones.size > 0) {
        return activeLeadPhones.has(c.phone) || c.manualProspectId?.startsWith("MANUAL-");
      }
      return true;
    });

    res.json(syncedConvos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET or initialize conversation by Lead/Prospect ID
router.get("/by-lead/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const isMongo = /^[a-f0-9]{24}$/.test(id);
    let lead = null;
    if (isMongo) {
      lead = await Lead.findById(id);
    }

    const convo = await findOrCreateConversation({
      leadId: isMongo ? id : null,
      manualProspectId: !isMongo ? id : "",
      prospectName: lead ? lead.name : req.query.name || "Customer",
      phone: lead ? lead.phone : req.query.phone || "",
      dealer: lead ? lead.dealer : req.query.dealer || "",
      vehicle: lead ? lead.vehicle : req.query.vehicle || "",
    });

    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single conversation
router.get("/:id", async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    res.json(convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE conversation and its associated lead
router.delete("/:id", async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Delete conversation and linked lead
    await Promise.all([
      Conversation.findByIdAndDelete(req.params.id),
      convo.leadId ? Lead.findByIdAndDelete(convo.leadId) : Promise.resolve(),
      convo.phone ? Lead.deleteMany({ phone: convo.phone }) : Promise.resolve(),
    ]);

    res.json({ message: "Conversation and associated lead deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST simulate customer response
router.post("/:id/simulate", async (req, res) => {
  try {
    const { id } = req.params;
    const { text, vehicle, dealer } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const convo = await Conversation.findById(id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });

    const now = new Date();
    const timeFormatted = formatTime(now);

    // 1. Push user message
    const userMessage = {
      id: `usr-${Date.now()}`,
      sender: "user",
      text: text.trim(),
      time: `Prospect · ${timeFormatted}`,
      status: "delivered",
    };
    convo.messages.push(userMessage);

    // 2. Update qualification heuristics dynamically
    const lower = text.toLowerCase();
    const qual = convo.qualification || {};
    if (lower.includes("month") || lower.includes("week") || lower.includes("asap") || lower.includes("soon") || lower.includes("today") || lower.includes("tomorrow")) {
      qual.timeline = "This month";
      qual.intent = "High Intent";
    }
    if (lower.includes("$") || lower.includes("budget") || lower.includes("50k") || lower.includes("60k") || lower.includes("price")) {
      qual.budget = lower.includes("60k") ? "$60,000" : "$50,000";
    }
    if (lower.includes("trade") || lower.includes("vehicle")) {
      qual.tradeIn = "Yes (Trade-in vehicle)";
    }
    if (lower.includes("finance") || lower.includes("loan") || lower.includes("cash") || lower.includes("quote")) {
      qual.finance = "Finance Requested";
    }
    convo.qualification = qual;

    // 3. Cycle suggestions to secondary or next options
    convo.suggestedResponses = SECONDARY_SUGGESTIONS;

    // 4. Generate AI response if in AI active mode
    let aiMessage = null;
    const isAi = convo.control === "AI active";
    if (isAi) {
      let aiReply = "Thanks — I've added that to your enquiry. Would you like me to secure a dealership test-drive time? Reply STOP to opt out";
      if (lower.includes("3:30") || lower.includes("call")) {
        aiReply = `Perfect — I've noted a 3:30pm phone consultation for you with the team at ${convo.dealer || dealer || "our dealership"}. Reply STOP to opt out`;
      } else if (lower.includes("finance")) {
        aiReply = "Certainly! We have competitive novated lease and tailored finance options available. Would you like our finance specialist to include a repayment schedule? Reply STOP to opt out";
      }

      aiMessage = {
        id: `ai-${Date.now() + 1}`,
        sender: "ai",
        text: aiReply,
        time: `AI Assistant · ${timeFormatted} · sent`,
        status: "sent",
      };
      convo.messages.push(aiMessage);
      convo.lastMessage = aiReply;
    } else {
      convo.lastMessage = text.trim();
    }

    convo.lastMessageAt = now;
    convo.msgCount = convo.messages.length;
    await convo.save();

    res.json({
      success: true,
      conversation: convo,
      userMessage,
      aiMessage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST manual reply from Demo Agent
router.post("/:id/agent-reply", async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const convo = await Conversation.findById(id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });

    const now = new Date();
    const timeFormatted = formatTime(now);

    const fullText = text.trim().endsWith("Reply STOP to opt out")
      ? text.trim()
      : `${text.trim()} Reply STOP to opt out`;

    const agentMessage = {
      id: `ag-${Date.now()}`,
      sender: "agent",
      text: fullText,
      time: `Demo Agent · ${timeFormatted} · sent`,
      status: "sent",
    };

    convo.messages.push(agentMessage);
    convo.lastMessage = fullText;
    convo.lastMessageAt = now;
    convo.msgCount = convo.messages.length;
    await convo.save();

    res.json({
      success: true,
      conversation: convo,
      agentMessage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST toggle control: takeover or resume AI
router.post("/:id/toggle-control", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "takeover" or "resume"

    const convo = await Conversation.findById(id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });

    const isTakeover = action === "takeover";
    convo.control = isTakeover ? "Human: Demo Agent" : "AI active";

    const systemText = isTakeover
      ? "Demo Agent has taken over this conversation. AI paused."
      : "AI assistant resumed by Demo Agent.";

    const systemMsg = {
      id: `sys-${Date.now()}`,
      sender: "system",
      text: systemText,
      time: "",
      status: "system",
    };

    convo.messages.push(systemMsg);
    convo.lastMessage = systemText;
    convo.lastMessageAt = new Date();
    await convo.save();

    // If linked to lead, update Lead document too
    if (convo.leadId) {
      await Lead.findByIdAndUpdate(convo.leadId, {
        control: convo.control,
      });
    }

    res.json({
      success: true,
      control: convo.control,
      conversation: convo,
      systemMessage: systemMsg,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
