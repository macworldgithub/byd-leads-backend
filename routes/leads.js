const express = require("express");
const router = express.Router();
const Lead = require("../models/Lead");
const Conversation = require("../models/Conversation");
const AuditTrail = require("../models/AuditTrail");

// GET all leads (with optional filters + pagination)
router.get("/", async (req, res) => {
  try {
    const { stage, dealer, tag, status, q, page, limit, sort } = req.query;
    const filter = {};

    if (stage) filter.stage = stage;
    if (dealer) filter.dealer = { $regex: dealer, $options: "i" };
    if (tag) filter.tag = tag;
    if (status) filter.status = status;

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { vehicle: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { stockNum: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { dealer: { $regex: q, $options: "i" } },
      ];
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * pageSize;

    // Sort
    let sortObj = { createdAt: -1 };
    if (sort === "score") sortObj = { score: -1 };
    if (sort === "name") sortObj = { name: 1 };
    if (sort === "received") sortObj = { receivedDaysAgo: 1 };

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(sortObj).skip(skip).limit(pageSize),
      Lead.countDocuments(filter),
    ]);

    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET distinct dealerships (for filter dropdown)
router.get("/dealerships", async (req, res) => {
  try {
    const dealers = await Lead.distinct("dealer");
    res.json(dealers.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET distinct statuses (for filter dropdown)
router.get("/statuses", async (req, res) => {
  try {
    const statuses = await Lead.distinct("status");
    res.json(statuses.filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET pipeline stats
router.get("/stats", async (req, res) => {
  try {
    const { stage, dealer, tag, status, q } = req.query;
    const filter = {};

    if (stage) filter.stage = stage;
    if (dealer) filter.dealer = { $regex: dealer, $options: "i" };
    if (tag) filter.tag = tag;
    if (status) filter.status = status;

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { vehicle: { $regex: q, $options: "i" } },
        { phone: { $regex: q, $options: "i" } },
        { stockNum: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { dealer: { $regex: q, $options: "i" } },
      ];
    }

    const [total, humanAssisted, aiQualifying, testDrives] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.countDocuments({ ...filter, control: { $regex: "Human", $options: "i" } }),
      Lead.countDocuments({ ...filter, stage: "AI QUALIFYING" }),
      Lead.countDocuments({ ...filter, stage: "TEST DRIVE BOOKED" }),
    ]);
    res.json({ total, humanAssisted, aiQualifying, testDrives });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single lead
router.get("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create lead
router.post("/", async (req, res) => {
  try {
    const lead = await Lead.create(req.body);
    try {
      await AuditTrail.create({
        message: `Prospect ${lead.name} created manually into ${lead.stage}`,
        actor: "Sales Agent",
        leadId: lead._id,
      });
    } catch (auditErr) {
      console.error("Audit trail error on manual lead creation:", auditErr);
    }
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update lead
router.put("/:id", async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE lead (cascade removes corresponding Conversation too)
router.delete("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      // Also check if id refers to a Conversation or prospect by phone
      const deletedConvo = await Conversation.findOneAndDelete({
        $or: [
          { _id: req.params.id },
          { leadId: req.params.id },
          { manualProspectId: req.params.id },
        ],
      });
      if (deletedConvo) {
        return res.json({ message: "Lead conversation deleted" });
      }
      return res.status(404).json({ error: "Lead not found" });
    }

    // Delete lead and its associated conversation by leadId or phone
    await Promise.all([
      Lead.findByIdAndDelete(req.params.id),
      Conversation.deleteMany({
        $or: [
          { leadId: lead._id },
          { manualProspectId: lead._id.toString() },
          { phone: lead.phone },
        ],
      }),
    ]);

    res.json({ message: "Lead and related conversation deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST import leads from CSV
const handleCsvImport = async (req, res) => {
  try {
    const { leads: rawRows = [], defaultDealer = "BYD Fairfield VIC", sendSms = true } = req.body;

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: "No leads data provided for import" });
    }

    if (rawRows.length > 500) {
      return res.status(400).json({ error: "Maximum 500 rows allowed per import" });
    }

    // Preload existing leads for duplicate checking
    const existingLeads = await Lead.find({}, "phone stockNum name");
    const existingPhoneSet = new Set();
    const existingStockSet = new Set();

    for (const l of existingLeads) {
      if (l.phone) {
        const clean = l.phone.replace(/\D/g, "");
        if (clean) existingPhoneSet.add(clean);
        if (clean.length >= 9) existingPhoneSet.add(clean.slice(-9));
      }
      if (l.stockNum) existingStockSet.add(l.stockNum.trim().toLowerCase());
    }

    const batchPhoneSet = new Set();
    const batchStockSet = new Set();

    let importedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;
    const results = [];
    const createdLeads = [];

    for (const row of rawRows) {
      // Find key values with case-insensitive matching
      const getVal = (possibleKeys) => {
        for (const k of Object.keys(row)) {
          const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const pk of possibleKeys) {
            if (normKey === pk.toLowerCase().replace(/[^a-z0-9]/g, "")) {
              return typeof row[k] === "string" ? row[k].trim() : String(row[k] || "").trim();
            }
          }
        }
        return "";
      };

      const firstName = getVal(["first name", "firstname", "first", "given name"]);
      const lastName = getVal(["last name", "lastname", "last", "surname", "family name"]);
      let name = getVal(["name", "full name", "prospect name", "customer name", "first name / name"]);
      if (!name && (firstName || lastName)) {
        name = `${firstName} ${lastName}`.trim();
      }

      const rawPhone = getVal(["mobile", "mobile number", "phone", "phone number", "contact", "cell", "cell phone"]);
      const email = getVal(["email", "email address", "e-mail", "mail"]);
      const dealer = getVal(["dealership", "dealer", "location"]) || defaultDealer || "BYD Fairfield VIC";
      const vehicle = getVal(["vehicle", "vehicle / enquiry", "car", "model", "enquiry", "vehicle name"]) || "BYD Seal";
      const notes = getVal(["notes", "note", "enquiry note", "enquiry desc", "comments", "description", "enquiry notes"]);
      const suburb = getVal(["suburb", "city", "address", "suburb/state"]);
      const state = getVal(["state", "region", "province"]);
      const leadId = getVal(["lead id", "leadid", "autogate id", "autogateid", "stock num", "stock number", "stock #", "stocknum", "id"]);

      // Validate name
      if (!name) {
        invalidCount++;
        results.push({
          name: "Unknown",
          phone: rawPhone || "—",
          outcome: "invalid",
          reason: "Missing Name",
        });
        continue;
      }

      // Validate and clean phone
      const digitsOnly = rawPhone.replace(/\D/g, "");
      if (!digitsOnly || digitsOnly.length < 8 || digitsOnly.length > 15) {
        invalidCount++;
        results.push({
          name,
          phone: rawPhone || "—",
          outcome: "invalid",
          reason: "Invalid Phone",
        });
        continue;
      }

      // Format mobile standard (e.g. 04xx xxx xxx if Australian 10-digit mobile)
      let formattedPhone = rawPhone;
      if (digitsOnly.length === 10 && digitsOnly.startsWith("04")) {
        formattedPhone = `${digitsOnly.slice(0, 4)} ${digitsOnly.slice(4, 7)} ${digitsOnly.slice(7)}`;
      } else if (digitsOnly.length === 9 && digitsOnly.startsWith("4")) {
        const withZero = "0" + digitsOnly;
        formattedPhone = `${withZero.slice(0, 4)} ${withZero.slice(4, 7)} ${withZero.slice(7)}`;
      } else if (digitsOnly.startsWith("614") && digitsOnly.length === 11) {
        const local = "0" + digitsOnly.slice(2);
        formattedPhone = `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
      }

      const phoneKey = digitsOnly.length >= 9 ? digitsOnly.slice(-9) : digitsOnly;
      const stockKey = leadId ? leadId.trim().toLowerCase() : "";

      // Duplicate Check
      const isDup =
        existingPhoneSet.has(phoneKey) ||
        existingPhoneSet.has(digitsOnly) ||
        batchPhoneSet.has(phoneKey) ||
        batchPhoneSet.has(digitsOnly) ||
        (stockKey && (existingStockSet.has(stockKey) || batchStockSet.has(stockKey)));

      if (isDup) {
        duplicateCount++;
        results.push({
          name,
          phone: rawPhone,
          outcome: "duplicate",
          reason: "Duplicate skipped",
        });
        continue;
      }

      // Mark in batch sets
      batchPhoneSet.add(phoneKey);
      batchPhoneSet.add(digitsOnly);
      if (stockKey) batchStockSet.add(stockKey);

      // Create new Lead
      const newLead = await Lead.create({
        name,
        phone: formattedPhone,
        email,
        dealer,
        vehicle,
        notes: notes || (suburb ? `Suburb: ${suburb}${state ? `, ${state}` : ""}` : ""),
        enquiryDesc: notes || `${vehicle} enquiry`,
        enquiryNote: suburb ? `Location: ${suburb} ${state}`.trim() : "",
        stockNum: leadId || `CSV-${Math.floor(1000 + Math.random() * 9000)}`,
        stage: sendSms ? "AI QUALIFYING" : "NEW ENQUIRIES",
        status: sendSms ? "qualification" : "new",
        tag: "Contact",
        control: "AI active",
        score: 10,
        source: "CSV Import",
        price: "$49,990",
        paintColor: "Apricity White",
      });

      // Update existing set so subsequent duplicates in same request are caught
      existingPhoneSet.add(phoneKey);
      existingPhoneSet.add(digitsOnly);
      if (stockKey) existingStockSet.add(stockKey);

      // If sendSms is enabled, initialize Conversation with AI opening SMS
      if (sendSms) {
        try {
          const leadFirstName = name.split(" ")[0] || "Customer";
          const carName = vehicle || "2025 BYD ATTO 3";
          const dealerName = dealer || "BYD Fairfield VIC";
          const now = new Date();

          await Conversation.create({
            leadId: newLead._id,
            prospectName: name,
            phone: formattedPhone,
            initials: name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase(),
            dealer: dealerName,
            status: "Contact",
            control: "AI active",
            suggestedResponses: [
              "I'm looking to buy this month",
              "My budget is around $60k",
              "I have a vehicle to trade",
            ],
            qualification: {
              intent: "—",
              budget: "—",
              timeline: "—",
              tradeIn: "—",
              finance: "—",
            },
            messages: [
              {
                id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                sender: "ai",
                text: `Hi ${leadFirstName}, thanks for your enquiry on the ${carName} with ${dealerName}. I'm the virtual assistant for our sales team — happy to answer questions or set up a test drive. When are you looking to get into a new car? Reply STOP to opt out`,
                time: `AI Assistant · just now · sent`,
                status: "sent",
              },
            ],
            lastMessage: `Hi ${leadFirstName}, thanks for your enquiry...`,
            lastMessageAt: now,
            msgCount: 1,
            daysAgo: 0,
          });
        } catch (convErr) {
          console.error("Conversation creation error during CSV import:", convErr);
        }
      }

      // Add to Audit Trail
      try {
        await AuditTrail.create({
          message: `Imported prospect ${name} (${formattedPhone}) via CSV into ${newLead.stage}`,
          actor: "CSV Importer",
          leadId: newLead._id,
        });
      } catch (auditErr) {
        console.error("Audit trail creation error during CSV import:", auditErr);
      }

      importedCount++;
      createdLeads.push(newLead);
      results.push({
        name,
        phone: formattedPhone,
        outcome: "imported",
        reason: "Imported (new)",
        leadId: newLead._id,
      });
    }

    res.json({
      success: true,
      imported: importedCount,
      duplicates: duplicateCount,
      invalid: invalidCount,
      total: rawRows.length,
      results,
      leads: createdLeads,
    });
  } catch (err) {
    console.error("CSV import error:", err);
    res.status(500).json({ error: err.message || "Failed to import CSV leads" });
  }
};

router.post("/import-csv", handleCsvImport);
router.post("/import", handleCsvImport);

module.exports = router;
