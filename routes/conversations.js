const express = require("express");
const router = express.Router();
const Conversation = require("../models/Conversation");
const Lead = require("../models/Lead");
const mobileMessage = require("../services/mobileMessage");
const { authenticate } = require("../middleware/auth");
const { getThreads, allowedSite, phoneKey, siteKey } = require("../services/threadHistory");
const { deliveryDb } = require("../services/messageDb");
const { phoneRegex, inboundId, receivedAt, inboundSite } = require("../services/smsEvent");
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

async function findOrCreateConversation(query) {
  const { leadId, manualProspectId, prospectName, phone, dealer } = query;
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
      control: "Human",
      suggestedResponses: [],
      qualification: {
        intent: "—",
        budget: "—",
        timeline: "—",
        tradeIn: "—",
        finance: "—",
      },
      messages: [],
      lastMessage: "",
      lastMessageAt: now,
      msgCount: 0,
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
    if (control === "ai") syncedConvos = [];
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
      sendSms: requestedSms = false,
    } = req.body;
    const sendSms = requestedSms === true;

    if (!prospectName || !phone) {
      return res.status(400).json({ error: "Prospect name and mobile phone number are required" });
    }

    const normPhone = mobileMessage.normalizeAustralianPhone(phone);
    if (!normPhone) {
      return res.status(400).json({ error: "A valid mobile phone number is required" });
    }

    const dealership = dealer || "BYD Fairfield VIC";
    const car = vehicle || "2025 BYD ATTO 3";
    if (sendSms && (typeof initialMessage !== "string" || !initialMessage.trim())) {
      return res.status(400).json({ error: "Write an SMS message before sending" });
    }

    // Find or create associated Lead
    let lead = await Lead.findOne({ phone: normPhone, dealer: dealership });
    if (!lead) {
      lead = await Lead.create({
        name: prospectName.trim(),
        phone: normPhone,
        dealer: dealership,
        vehicle: car,
        stage: "NEW ENQUIRIES",
        status: "new",
        notes: "Conversation initiated directly from Lead Centre",
        source: "Direct SMS",
      });
    }

    // Only a message explicitly composed and submitted by staff may be sent.
    let openingText = typeof initialMessage === "string" ? initialMessage.trim() : "";
    if (sendSms && !openingText.toLowerCase().includes("reply stop")) {
      openingText += " Reply STOP to opt out";
    }

    let initialSmsResult = null;
    let smsError = null;

    if (sendSms) {
      try {
        initialSmsResult = await mobileMessage.sendSms({
          requestedBy: req.user.id || req.user.email,
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
    const initialMsg = {
      id: initialSmsResult?.messageId || `msg-${Date.now()}`,
      sender: "agent",
      text: openingText,
      time: `${req.user.name || req.user.email || "Staff"} · ${formatTime(now)} · sent`,
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
      convo.control = "Human";
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
        control: "Human",
        suggestedResponses: [],
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

// Retired simulation endpoint: it must never dispatch a real customer SMS.
router.post("/:id/simulate", (req, res) => {
  res.status(410).json({ error: "SMS conversations are managed manually by staff" });
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

    if (!convo.phone) return res.status(400).json({ success: false, error: "Recipient phone is required" });

    // Live dispatch via MobileMessage gateway
    let smsResult = null;
    let smsError = null;

    if (convo.phone) {
      try {
        smsResult = await mobileMessage.sendSms({
          requestedBy: req.user.id || req.user.email,
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

// Keep the legacy takeover endpoint compatible; AI cannot be resumed.
router.post("/:id/toggle-control", async (req, res) => {
  try {
    if (req.body.action !== "takeover") {
      return res.status(400).json({ error: "Only manual SMS is available" });
    }
    const convo = await Conversation.findByIdAndUpdate(req.params.id, { control: "Human" }, { new: true });
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    if (convo.leadId) await Lead.findByIdAndUpdate(convo.leadId, { control: "Human" });
    res.json({ success: true, control: "Human", conversation: convo });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

    // An uncorrelated reply can only inherit a site when the phone has one owner.
    const db = await deliveryDb();
    const [leads, clients] = await Promise.all([
      Lead.find({ phone: phoneSearchKey }),
      db.collection('clients').find({ phone: phoneSearchKey }).toArray(),
    ]);
    const originalId = req.body.original_message_id;
    const original = originalId ? await db.collection('messages').findOne({ provider_message_id: originalId, direction: 'outbound' }) : null;
    const source = originalId ? await Conversation.findOne({ messages: { $elemMatch: { id: originalId, sender: { $ne: 'user' } } } }) : null;
    const site = inboundSite(original, source, leads, clients);
    const matchedLead = leads.find(lead => siteKey(lead.dealer) === siteKey(site));
    let convo;
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
          control: 'Human', messages: [], msgCount: 0,
        } }, { upsert: true, new: true }
      );
    }
    const appended = await Conversation.updateOne(
      { _id: convo._id, 'messages.id': { $ne: messageId } },
      { $push: { messages: userMsg }, $inc: { msgCount: 1 }, $set: { control: 'Human', lastMessage: text, lastMessageAt: now } }
    );
    if (!appended.modifiedCount) return res.json({ success: true, duplicate: true, conversationId: convo._id });

    res.json({
      success: true,
      conversationId: convo._id,
      userMessage: userMsg,
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
