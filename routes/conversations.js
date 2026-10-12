const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");
const Lead = require("../models/Lead");
const mobileMessage = require("../services/mobileMessage");
const { authenticate } = require("../middleware/auth");
const { getThreads, allowedSite, phoneKey, siteKey } = require("../services/threadHistory");
const { deliveryDb } = require("../services/messageDb");
const { phoneRegex, inboundId, receivedAt } = require("../services/smsEvent");
const mongoose = require("mongoose");
const history = (req, scope = true, phone = req.smsConversation?.phone || req.query.phone) => deliveryDb().then(db => getThreads(mongoose.connection.db, db, req.user, scope ? req.query.dealer || req.query.site : undefined, { phone }));
router.use((req, res, next) => {
  if (req.method === "POST" && ["/inbound", "/status"].includes(req.path)) return next();
  return authenticate(req, res, next);
});
router.use(async (req, res, next) => {
  try {
    const id = req.path.split("/")[1];
    if (/^[a-f0-9]{24}$/i.test(id)) {
      const doc = await Conversation.findById(id);
      if (!doc || !allowedSite(req.user, doc.dealer)) return res.status(404).json({ error: "Conversation not found" });
      req.smsConversation = doc;
    }
    if (req.method === "POST" && req.path === "/" && !allowedSite(req.user, req.body.dealer)) return res.status(403).json({ error: "Site access denied" });
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
  const { leadId, manualProspectId, prospectName, phone, dealer, vehicle, sendInitialSms } = query;
  let convo = null;

  if (leadId) {
    convo = await Conversation.findOne({ leadId });
  }
  if (!convo && manualProspectId) {
    convo = await Conversation.findOne({ manualProspectId });
  }
  if (!convo && phone) {
    convo = await Conversation.findOne({ phone, dealer });
  }

  if (!convo) {
    const firstName = prospectName ? prospectName.split(" ")[0] : "Customer";
    const car = vehicle || "2025 BYD ATTO 1";
    const dealership = dealer || "BYD Fairfield VIC";
    const now = new Date();
    const openingText = `Hi ${firstName}, thanks for your enquiry on the ${car} with ${dealership}. I'm the virtual assistant for our sales team — happy to answer questions or set up a test drive. When are you looking to get into a new car? Reply STOP to opt out`;

    let initialSmsResult = null;
    let initialSmsError = null;
    if (sendInitialSms && phone) {
      try {
        initialSmsResult = await mobileMessage.sendSms({
          to: phone,
          message: openingText,
        });
      } catch (smsErr) {
        initialSmsError = smsErr.message;
        console.error("Failed to send initial SMS via MobileMessage:", smsErr.message);
      }
    }

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
      messages: sendInitialSms ? [
        {
          id: initialSmsResult?.messageId || `msg-${Date.now()}`,
          sender: "ai",
          text: openingText,
          time: `AI Assistant · ${formatTime(now)} · sent`,
          status: initialSmsError ? "failed" : initialSmsResult?.simulated ? "simulated" : "sent",
        },
      ] : [],
      lastMessage: sendInitialSms ? `Hi ${firstName}, thanks for your enquiry...` : "",
      lastMessageAt: now,
      msgCount: sendInitialSms ? 1 : 0,
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
    let syncedConvos = await history(req);
    if (control === "ai") syncedConvos = syncedConvos.filter(c => c.control === "AI active");
    if (control === "human") syncedConvos = syncedConvos.filter(c => /human|agent/i.test(c.control));
    if (q) syncedConvos = syncedConvos.filter(c => (c.prospectName + " " + c.phone).toLowerCase().includes(q.toLowerCase()));
    res.json(syncedConvos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a new conversation (§8.2, ACMA Two-Way SMS)
router.post("/", async (req, res) => {
  try {
    const {
      prospectName,
      phone,
      dealer,
      vehicle,
      initialMessage,
      control = "AI active",
      sendSms = true,
    } = req.body;

    if (!prospectName || !phone) {
      return res.status(400).json({ error: "Prospect name and mobile phone number are required" });
    }

    const normPhone = mobileMessage.normalizeAustralianPhone(phone);
    if (!normPhone) {
      return res.status(400).json({ error: "A valid mobile phone number is required" });
    }

    const dealership = dealer || "BYD Fairfield VIC";
    const car = vehicle || "2025 BYD ATTO 3";
    const firstName = prospectName.trim().split(" ")[0];

    // Find or create associated Lead
    let lead = await Lead.findOne({ phone: normPhone, dealer: dealership });
    if (!lead) {
      lead = await Lead.create({
        name: prospectName.trim(),
        phone: normPhone,
        dealer: dealership,
        vehicle: car,
        stage: control === "AI active" ? "AI QUALIFYING" : "NEW ENQUIRIES",
        status: control === "AI active" ? "qualification" : "new",
        notes: "Conversation initiated directly from Lead Centre",
        source: "Direct SMS",
      });
    }

    // Prepare initial message
    let openingText =
      initialMessage && initialMessage.trim()
        ? initialMessage.trim()
        : `Hi ${firstName}, thanks for your enquiry on the ${car} with ${dealership}. I'm the virtual assistant for our sales team — happy to answer questions or set up a test drive. When are you looking to get into a new car? Reply STOP to opt out`;

    if (!openingText.toLowerCase().includes("reply stop")) {
      openingText += " Reply STOP to opt out";
    }

    let initialSmsResult = null;
    let smsError = null;

    if (sendSms) {
      try {
        initialSmsResult = await mobileMessage.sendSms({
          to: normPhone,
          message: openingText,
          customRef: `new-convo-${lead._id}`,
        });
      } catch (smsErr) {
        console.error("Failed to send initial SMS via MobileMessage:", smsErr.message);
        smsError = smsErr.message;
      }
    }

    const now = new Date();
    const isAi = control === "AI active";
    const initialSender = isAi ? "ai" : "agent";
    const senderLabel = isAi ? "AI Assistant" : "Agent";

    const initialMsg = {
      id: initialSmsResult?.messageId || `msg-${Date.now()}`,
      sender: initialSender,
      text: openingText,
      time: `${senderLabel} · ${formatTime(now)} · sent`,
      status: smsError ? "failed" : initialSmsResult?.simulated ? "simulated" : "sent",
      createdAt: now,
    };

    // Check if conversation already exists for this lead or phone
    let convo = await Conversation.findOne({
      $or: [{ leadId: lead._id }, { phone: normPhone, dealer: dealership }],
    });

    if (convo) {
      convo.prospectName = prospectName.trim();
      convo.dealer = dealership;
      convo.control = control;
      if (sendSms) convo.messages.push(initialMsg);
      if (sendSms) { convo.lastMessage = openingText; convo.lastMessageAt = now; }
      convo.msgCount = convo.messages.length;
      await convo.save();
    } else {
      convo = await Conversation.create({
        leadId: lead._id,
        prospectName: prospectName.trim(),
        phone: normPhone,
        initials: prospectName
          .trim()
          .split(" ")
          .map((n) => n[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        dealer: dealership,
        status: "Contact",
        control,
        suggestedResponses: DEFAULT_SUGGESTIONS,
        qualification: {
          intent: "—",
          budget: "—",
          timeline: "—",
          tradeIn: "—",
          finance: "—",
        },
        messages: sendSms ? [initialMsg] : [],
        lastMessage: sendSms ? openingText : "",
        lastMessageAt: now,
        msgCount: sendSms ? 1 : 0,
        daysAgo: 0,
      });
    }

    res.status(smsError ? 502 : 201).json({
      success: !smsError,
      error: smsError || undefined,
      conversation: (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id))) || convo,
      lead,
      smsResult: initialSmsResult,
      smsError,
    });
  } catch (err) {
    console.error("Error creating conversation:", err);
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

    const dealer = lead ? lead.dealer : req.query.dealer || "";
    if (!allowedSite(req.user, dealer)) return res.status(404).json({ error: "Lead not found" });
    const existing = (await history(req, false, lead?.phone || req.query.phone)).find(c => (c.leadId && String(c.leadId) === id) || (phoneKey(c.phone) === phoneKey(lead?.phone || req.query.phone) && (c.sites || [c.dealer]).some(site => siteKey(site) === siteKey(dealer))));
    if (existing) return res.json(existing);
    const convo = await findOrCreateConversation({
      leadId: isMongo ? id : null,
      manualProspectId: !isMongo ? id : "",
      prospectName: lead ? lead.name : req.query.name || "Customer",
      phone: lead ? lead.phone : req.query.phone || "",
      dealer: lead ? lead.dealer : req.query.dealer || "",
      vehicle: lead ? lead.vehicle : req.query.vehicle || "",
      sendInitialSms: req.query.sendSms === "true",
    });

    const unified = (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id)));
    res.json(unified || convo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single conversation
router.get("/:id", async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    const unified = (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id)));
    res.json(unified || convo);
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

// POST simulate customer response or handle user message
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
    if (
      lower.includes("month") ||
      lower.includes("week") ||
      lower.includes("asap") ||
      lower.includes("soon") ||
      lower.includes("today") ||
      lower.includes("tomorrow")
    ) {
      qual.timeline = "This month";
      qual.intent = "High Intent";
    }
    if (
      lower.includes("$") ||
      lower.includes("budget") ||
      lower.includes("50k") ||
      lower.includes("60k") ||
      lower.includes("price")
    ) {
      qual.budget = lower.includes("60k") ? "$60,000" : "$50,000";
    }
    if (lower.includes("trade") || lower.includes("vehicle")) {
      qual.tradeIn = "Yes (Trade-in vehicle)";
    }
    if (
      lower.includes("finance") ||
      lower.includes("loan") ||
      lower.includes("cash") ||
      lower.includes("quote")
    ) {
      qual.finance = "Finance Requested";
    }
    convo.qualification = qual;

    // 3. Cycle suggestions to secondary options
    convo.suggestedResponses = SECONDARY_SUGGESTIONS;

    // 4. Generate AI response if in AI active mode
    let aiMessage = null;
    let smsResult = null;
    const isAi = convo.control === "AI active";
    if (isAi) {
      let aiReply =
        "Thanks — I've added that to your enquiry. Would you like me to secure a dealership test-drive time? Reply STOP to opt out";
      if (lower.includes("3:30") || lower.includes("call")) {
        aiReply = `Perfect — I've noted a 3:30pm phone consultation for you with the team at ${convo.dealer || dealer || "our dealership"}. Reply STOP to opt out`;
      } else if (lower.includes("finance")) {
        aiReply =
          "Certainly! We have competitive novated lease and tailored finance options available. Would you like our finance specialist to include a repayment schedule? Reply STOP to opt out";
      }

      // If phone is available, dispatch live SMS to prospect!
      if (convo.phone) {
        try {
          smsResult = await mobileMessage.sendSms({
            to: convo.phone,
            message: aiReply,
            customRef: `ai-sim-${convo._id}`,
          });
        } catch (smsErr) {
          console.error("AI live SMS dispatch failed:", smsErr.message);
        }
      }

      aiMessage = {
        id: smsResult?.messageId || `ai-${Date.now() + 1}`,
        sender: "ai",
        text: aiReply,
        time: `AI Assistant · ${timeFormatted} · sent`,
        status: !smsResult ? "failed" : smsResult.simulated ? "simulated" : "sent",
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
      conversation: (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id))) || convo,
      userMessage,
      aiMessage,
      smsResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST manual reply from Sales / Demo Agent
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

    // Live dispatch via MobileMessage gateway
    let smsResult = null;
    let smsError = null;

    if (convo.phone) {
      try {
        smsResult = await mobileMessage.sendSms({
          to: convo.phone,
          message: fullText,
          customRef: `agent-${convo._id}`,
        });
      } catch (err) {
        console.error("Failed to dispatch agent SMS via MobileMessage:", err.message);
        smsError = err.message;
      }
    }

    const agentMessage = {
      id: smsResult?.messageId || `ag-${Date.now()}`,
      sender: "agent",
      text: fullText,
      time: `Agent · ${timeFormatted} · sent`,
      status: smsError ? "failed" : smsResult?.simulated ? "simulated" : "sent",
    };

    await Conversation.updateOne({ _id: convo._id }, {
      $push: { messages: agentMessage }, $inc: { msgCount: 1 },
      $set: { control: 'Human', lastMessage: fullText, lastMessageAt: now },
    });

    res.status(smsError ? 502 : 200).json({
      success: !smsError,
      error: smsError || undefined,
      conversation: (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id))) || convo,
      agentMessage,
      smsResult,
      smsError,
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
    convo.control = isTakeover ? "Human: Sales Agent" : "AI active";

    const systemText = isTakeover
      ? "Sales Agent has taken over this conversation. AI paused."
      : "AI assistant resumed by Sales Agent.";

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

    if (convo.leadId) {
      await Lead.findByIdAndUpdate(convo.leadId, {
        control: convo.control,
      });
    }

    res.json({
      success: true,
      control: convo.control,
      conversation: (await history(req, false, convo.phone)).find(c => c.threadIds.includes(String(convo._id))) || convo,
      systemMessage: systemMsg,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inbound Webhooks for MobileMessage (Two-Way SMS) ─────────────────────────
// Endpoint hit by MobileMessage webhook when customer replies or delivers
router.post("/inbound", async (req, res) => {
  try {
    const rawFrom =
      req.body.from ||
      req.body.sender ||
      req.body.phone ||
      req.body.from_number ||
      req.body.mobile;
    const rawMessage = req.body.message || req.body.body || req.body.text || "";


    if (!rawFrom || !rawMessage) {
      return res.status(400).json({ error: "Missing phone or message content" });
    }

    const normPhone = mobileMessage.normalizeAustralianPhone(rawFrom);
    const text = String(rawMessage).trim();
    const phoneSearchKey = phoneRegex(normPhone);
    const messageId = inboundId(req.body, normPhone, text);

    // Match formatted/local phone numbers exactly after normalization.
    let [matchedLead, convo] = await Promise.all([
      Lead.findOne({ phone: phoneSearchKey }),
      Conversation.findOne({ phone: phoneSearchKey }),
    ]);

    const originalId = req.body.original_message_id;
    const original = originalId ? await (await deliveryDb()).collection('messages').findOne({ provider_message_id: originalId, direction: 'outbound' }) : null;
    const source = originalId ? await Conversation.findOne({ 'messages.id': originalId }) : null;
    const client = await (await deliveryDb()).collection('clients').findOne({ phone: phoneSearchKey });
    const site = original?.site || source?.dealer || matchedLead?.dealer || client?.site_location || client?.site || '';
    const candidates = await Conversation.find({ phone: phoneSearchKey }).sort({ lastMessageAt: -1 });
    convo = source || candidates.find(c => siteKey(c.dealer) === siteKey(site)) || null;
    if (messageId && convo?.messages.some(m => m.id === String(messageId))) return res.json({ success: true, duplicate: true, conversationId: convo._id });
    const now = receivedAt(req.body);
    const timeFormatted = formatTime(now);

    const userMsg = {
      id: messageId || `in-${Date.now()}`,
      sender: "user",
      text,
      time: `Prospect · ${timeFormatted}`,
      status: "received",
      createdAt: now,
    };

    if (!convo) {
      const identity = require('crypto').createHash('sha256').update(siteKey(site) + ':' + phoneKey(normPhone)).digest('hex').slice(0, 24);
      convo = await Conversation.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(identity) },
        { $setOnInsert: {
          leadId: matchedLead?._id || undefined,
          prospectName: matchedLead?.name || 'Customer (' + normPhone + ')',
          phone: normPhone, dealer: site, status: 'Contact',
          control: matchedLead ? 'AI active' : 'Human', messages: [], msgCount: 0,
        } }, { upsert: true, new: true }
      );
    }
    const appended = await Conversation.updateOne(
      { _id: convo._id, 'messages.id': { $ne: messageId } },
      { $push: { messages: userMsg }, $inc: { msgCount: 1 }, $set: { lastMessage: text, lastMessageAt: now } }
    );
    if (!appended.modifiedCount) return res.json({ success: true, duplicate: true, conversationId: convo._id });

    // If AI active, auto-reply via MobileMessage
    let aiMsg = null;
    if (convo.control === "AI active") {
      const lower = text.toLowerCase();
      let aiReply =
        "Thanks for getting back to us! Would you like to schedule a showroom walkthrough or test-drive? Reply STOP to opt out";

      if (lower.includes("yes") || lower.includes("book") || lower.includes("test")) {
        aiReply = `Wonderful! I have test-drive slots available today or tomorrow at ${convo.dealer || "our dealership"}. What time suits you best? Reply STOP to opt out`;
      } else if (lower.includes("price") || lower.includes("cost") || lower.includes("quote")) {
        aiReply =
          "We offer comprehensive drive-away pricing with current manufacturer promotions. Would you prefer a tailored PDF quote sent over? Reply STOP to opt out";
      }

      let smsResult = null;
      try {
        smsResult = await mobileMessage.sendSms({
          to: normPhone,
          message: aiReply,
          customRef: `ai-reply-${convo._id}`,
        });
      } catch (err) {
        console.error("Failed to send AI auto-reply SMS:", err.message);
      }

      aiMsg = {
        id: smsResult?.messageId || `ai-${Date.now()}`,
        sender: "ai",
        text: aiReply,
        time: `AI Assistant · ${formatTime(new Date())} · sent`,
        status: !smsResult ? "failed" : smsResult.simulated ? "simulated" : "sent",
      };
      await Conversation.updateOne(
        { _id: convo._id }, { $push: { messages: aiMsg }, $inc: { msgCount: 1 },
          $set: { lastMessage: aiReply, lastMessageAt: new Date() } }
      );
    }

    res.json({
      success: true,
      conversationId: convo._id,
      userMessage: userMsg,
      aiMessage: aiMsg,
    });
  } catch (err) {
    console.error("Inbound SMS webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delivery receipts (DLR) webhook
router.post("/status", async (req, res) => {
  try {
    const { message_id, status } = req.body;
    if (message_id && status) {
      await Conversation.updateMany(
        { "messages.id": message_id },
        { $set: { "messages.$.status": status.toLowerCase() } }
      );
    }
    if (message_id && status) await (await deliveryDb()).collection("messages").updateMany({ provider_message_id: message_id }, { $set: { status: status.toLowerCase() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
