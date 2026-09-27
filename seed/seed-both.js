/**
 * seed-both.js
 * Comprehensive, idempotent import and upsert script for `both.json`.
 *
 * Capabilities:
 *  - Upserts Leads into the `Lead` collection (matches on virtualyardId / leadId).
 *  - Upserts Test Drives into the `Appointment` collection (matches on appointmentId).
 *  - Upserts unique vehicles into the `Inventory` collection (matches on identifier + platform).
 *  - Non-destructive: Inserts new records, updates modified records, ignores unchanged duplicates.
 *
 * Usage:
 *   node seed/seed-both.js
 *   node seed/seed-both.js path/to/custom-both.json
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
} catch (e) {}

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const Lead = require("../models/Lead");
const Appointment = require("../models/Appointment");
const Inventory = require("../models/Inventory");
const Dealership = require("../models/Dealership");

// Helper to locate both.json
function findBothJson(customPath) {
  if (customPath && fs.existsSync(customPath)) {
    return path.resolve(customPath);
  }
  const possiblePaths = [
    path.join(__dirname, "../both.json"),
    path.join(__dirname, "../../both.json"),
    path.join(__dirname, "both.json"),
    path.resolve("both.json"),
    path.resolve("../both.json"),
    "d:/byd-leads/byd-leads-backend/both.json",
    "d:/byd-leads-new/both.json",
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error("Could not locate both.json in any known directory.");
}

// Format appointment date
function formatAppointmentWhen(dateStr) {
  if (!dateStr) return "Upcoming Date";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Helper: Calculate lead score
function calculateScore(lead, hasTestDrive) {
  if (hasTestDrive) return 92;
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete" || stage === "deal") {
    return 95;
  }
  if (stage === "in_contact" || status.includes("BOOKING") || status.includes("VALUATION")) {
    return 78;
  }
  if (stage === "assigned") {
    return 65;
  }
  if (status.includes("LOST") || status.includes("CANCELLED")) {
    return 20;
  }
  return 55;
}

// Helper: Map lead tag
function mapTag(lead, hasTestDrive) {
  if (hasTestDrive) return "Commitment";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("LOST") || status.includes("CANCELLED")) return "Opted Out";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "deal" || stage === "complete") {
    return "Commitment";
  }
  if (lead.assignedTo && lead.assignedTo !== "Not Assigned") return "Human assisted";
  return "Contact";
}

// Helper: Map lead color
function mapColor(lead, hasTestDrive) {
  if (hasTestDrive) return "green";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("LOST") || status.includes("CANCELLED")) return "red";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "deal" || stage === "complete") {
    return "green";
  }
  if (stage === "in_contact" || lead.tab === "follow_up") return "amber";
  return "blue";
}

// Helper: Map pipeline stage
function mapStage(lead, hasTestDrive) {
  if (hasTestDrive) return "TEST DRIVE BOOKED";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("BOOKING") || status.includes("TEST DRIVE")) return "TEST DRIVE BOOKED";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete") return "DELIVERED";
  if (status.includes("LOST") || status.includes("CANCELLED")) return "LOST";
  if (stage === "in_contact" || stage === "assigned") return "AI QUALIFYING";
  return "NEW ENQUIRIES";
}

// Helper: Map status
function mapStatus(lead, hasTestDrive) {
  if (hasTestDrive) return "committed";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete") return "sold";
  if (status.includes("LOST") || status.includes("CANCELLED")) return "lost";
  if (stage === "in_contact" || stage === "assigned") return "qualification";
  return "new";
}

// Helper: Calculate days ago
function calculateDaysAgo(dateStr) {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.floor((todayMidnight - targetMidnight) / (1000 * 60 * 60 * 24)));
}

async function runSeed(filePath) {
  console.log("================================================================================");
  console.log("🚀  BYD Leads CRM — JSON Database Upsert & Sync");
  console.log("================================================================================");

  const jsonPath = findBothJson(filePath);
  console.log(`📂 Source file: ${jsonPath}`);

  const rawData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const leads = rawData.leads || [];
  const testDrives = rawData.testDrives || [];
  console.log(`📊 Parsed payload: ${leads.length} leads, ${testDrives.length} test drives.\n`);

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/byd_leads_crm";
  console.log(`⏳ Connecting to MongoDB...`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 25000 });
  console.log("✅ MongoDB Connected successfully.\n");

  // Map test drives by leadId for quick cross-referencing
  const testDrivesMap = new Map();
  testDrives.forEach((td) => {
    if (td.leadId) {
      testDrivesMap.set(String(td.leadId), td);
    }
  });

  const BATCH_SIZE = 500;

  // ---------------------------------------------------------------------------
  // 1. UPSERT LEADS
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("1️⃣  Processing Leads Collection...");
  console.log("--------------------------------------------------------------------------------");

  const leadOps = [];
  const processedLeadIds = new Set();

  for (const item of leads) {
    const leadId = String(item.leadId || item._id);
    processedLeadIds.add(leadId);
    const linkedTd = testDrivesMap.get(leadId);
    const hasTestDrive = Boolean(linkedTd);

    const cust = item.customer || {};
    const fullName =
      cust.fullName ||
      [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim() ||
      linkedTd?.customer?.fullName ||
      "Prospect";

    const phone = cust.phone || cust.mobilePhone || cust.homePhone || linkedTd?.customer?.phone || "";
    const email = cust.email || linkedTd?.customer?.email || "";

    const veh = item.vehicle || {};
    const vehicleStr =
      veh.raw ||
      [veh.year, veh.colour, veh.make || "BYD", veh.model].filter(Boolean).join(" ").trim() ||
      "BYD Vehicle";

    const dealerStr = veh.yard || linkedTd?.location || "BYD Dealership";
    const stockNum = veh.stockNo || "";
    const priceStr = veh.price ? `$${Number(veh.price).toLocaleString()}` : (veh.priceRaw || "");

    const score = calculateScore(item, hasTestDrive);
    const tag = mapTag(item, hasTestDrive);
    const color = mapColor(item, hasTestDrive);
    const stage = mapStage(item, hasTestDrive);
    const status = mapStatus(item, hasTestDrive);
    const daysAgo = calculateDaysAgo(item.leadDate || item.scrapedAt);

    const doc = {
      name: fullName,
      vehicle: vehicleStr,
      dealer: dealerStr,
      score,
      tag,
      color,
      stage,
      status,
      source: item.source || "Virtual Yard",
      phone,
      email,
      stockNum,
      control: item.assignedTo && item.assignedTo !== "Not Assigned" ? `Assigned: ${item.assignedTo}` : "AI active",
      receivedDaysAgo: daysAgo,
      notes: item.previewText || "",
      enquiryDesc: item.previewText || `Virtual Yard enquiry - ${item.status || "NEW"}`,
      enquiryNote: item.status ? `Status: ${item.status} | Stage: ${item.stageText || item.stage}` : "",
      price: priceStr,
      paintColor: veh.colour || "",
      platform: "virtualyard",

      leadId: leadId,
      virtualyardId: leadId,
      customerId: item.customerId ? String(item.customerId) : null,
      vyStage: item.stage || "",
      vyStageText: item.stageText || "",
      vyTab: item.tab || "",
      vyStatus: item.status || "",
      stageText: item.stageText || item.stage || "NEW",
      tab: item.tab || "inbox",
      previewText: item.previewText || "",
      assignedTo: item.assignedTo || "",
      lastContact: item.lastContact || "",
      leadDate: item.leadDate ? new Date(item.leadDate) : (item.scrapedAt ? new Date(item.scrapedAt) : new Date()),
      leadCreatedDate: item.leadDate ? new Date(item.leadDate) : (item.scrapedAt ? new Date(item.scrapedAt) : new Date()),
      testDrive: linkedTd
        ? {
            testDriveDate: linkedTd.testDriveDate ? new Date(linkedTd.testDriveDate) : null,
            location: linkedTd.location || "",
            status: linkedTd.status || "Confirmed",
            confirmed: true,
          }
        : {
            testDriveDate: null,
            location: "",
            status: "",
            confirmed: false,
          },
    };

    leadOps.push({
      updateOne: {
        filter: { leadId: leadId },
        update: { $set: doc },
        upsert: true,
      },
    });
  }

  // Also include unmatched test drives as separate leads so no prospect is dropped
  let unmatchedTdCount = 0;
  for (const td of testDrives) {
    const tdLeadId = String(td.leadId);
    if (!processedLeadIds.has(tdLeadId)) {
      unmatchedTdCount++;
      const cust = td.customer || {};
      const fullName = cust.fullName || [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim() || "Test Drive Prospect";
      const customId = `td-${td._id || td.leadId}`;

      const doc = {
        name: fullName,
        vehicle: "BYD Vehicle",
        dealer: td.location || "BYD Dealership",
        score: 90,
        tag: "Commitment",
        color: "green",
        stage: "TEST DRIVE BOOKED",
        status: "committed",
        source: "Virtual Yard Test Drive",
        phone: cust.phone || "",
        email: cust.email || "",
        stockNum: "",
        control: "AI active",
        notes: `Test Drive Booking (${td.status || "Confirmed"})`,
        enquiryDesc: `Test drive scheduled for ${td.testDriveDate ? new Date(td.testDriveDate).toLocaleDateString() : "upcoming date"}`,
        enquiryNote: `Location: ${td.location}`,
        price: "",
        paintColor: "",
        platform: "virtualyard",

        leadId: customId,
        virtualyardId: customId,
        customerId: null,
        vyStage: "assigned",
        vyStageText: "Test Drive Confirmed",
        vyTab: "inbox",
        vyStatus: "TEST DRIVE",
        stageText: "Test Drive Confirmed",
        tab: "inbox",
        previewText: `Test Drive Booking for ${td.location}`,
        assignedTo: "",
        lastContact: "",
        leadDate: td.testDriveDate ? new Date(td.testDriveDate) : new Date(),
        leadCreatedDate: td.testDriveDate ? new Date(td.testDriveDate) : new Date(),
        testDrive: {
          testDriveDate: td.testDriveDate ? new Date(td.testDriveDate) : null,
          location: td.location || "",
          status: td.status || "Confirmed",
          confirmed: true,
        },
      };

      leadOps.push({
        updateOne: {
          filter: { leadId: customId },
          update: { $set: doc },
          upsert: true,
        },
      });
    }
  }

  let leadUpserted = 0;
  let leadModified = 0;
  let leadMatched = 0;

  for (let i = 0; i < leadOps.length; i += BATCH_SIZE) {
    const chunk = leadOps.slice(i, i + BATCH_SIZE);
    const res = await Lead.bulkWrite(chunk, { ordered: false });
    leadUpserted += res.upsertedCount || 0;
    leadModified += res.modifiedCount || 0;
    leadMatched += res.matchedCount || 0;
    process.stdout.write(`   ↳ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(leadOps.length / BATCH_SIZE)} processed (${Math.min(i + BATCH_SIZE, leadOps.length)}/${leadOps.length})\r`);
  }
  const leadUnchanged = Math.max(0, leadMatched - leadModified);
  console.log(`\n   ✅ Leads Upsert Finished.`);
  console.log(`      - Total Processed:   ${leadOps.length}`);
  console.log(`      - Newly Inserted:    ${leadUpserted}`);
  console.log(`      - Updated/Modified:  ${leadModified}`);
  console.log(`      - Unchanged/Ignored: ${leadUnchanged} (already identical)\n`);

  // ---------------------------------------------------------------------------
  // 2. UPSERT APPOINTMENTS (TEST DRIVES)
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("2️⃣  Processing Appointments Collection (Test Drives)...");
  console.log("--------------------------------------------------------------------------------");

  const appointmentOps = [];
  for (const td of testDrives) {
    const appointmentId = String(td._id);
    const leadId = td.leadId ? String(td.leadId) : "";
    const cust = td.customer || {};
    const prospectName =
      cust.fullName ||
      [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim() ||
      "Test Drive Prospect";

    const linkedLead = leads.find((l) => String(l.leadId || l._id) === leadId);
    const veh = linkedLead?.vehicle || {};
    const vehicleStr =
      veh.raw ||
      [veh.year, veh.colour, veh.make || "BYD", veh.model].filter(Boolean).join(" ").trim() ||
      "BYD Vehicle";

    const apptDoc = {
      appointmentId,
      leadId,
      when: formatAppointmentWhen(td.testDriveDate),
      prospectName,
      phone: cust.phone || "",
      email: cust.email || "",
      type: "Test Drive",
      vehicle: vehicleStr,
      dealership: td.location || "BYD Dealership",
      location: td.location || "BYD Dealership",
      bookedBy: "AI",
      status: td.status || "Confirmed",
      testDriveDate: td.testDriveDate ? new Date(td.testDriveDate) : null,
      scrapedAt: td.scrapedAt ? new Date(td.scrapedAt) : new Date(),
      platform: "virtualyard",
    };

    appointmentOps.push({
      updateOne: {
        filter: { appointmentId: appointmentId },
        update: { $set: apptDoc },
        upsert: true,
      },
    });
  }

  let apptUpserted = 0;
  let apptModified = 0;
  let apptMatched = 0;

  for (let i = 0; i < appointmentOps.length; i += BATCH_SIZE) {
    const chunk = appointmentOps.slice(i, i + BATCH_SIZE);
    const res = await Appointment.bulkWrite(chunk, { ordered: false });
    apptUpserted += res.upsertedCount || 0;
    apptModified += res.modifiedCount || 0;
    apptMatched += res.matchedCount || 0;
    process.stdout.write(`   ↳ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(appointmentOps.length / BATCH_SIZE)} processed (${Math.min(i + BATCH_SIZE, appointmentOps.length)}/${appointmentOps.length})\r`);
  }
  const apptUnchanged = Math.max(0, apptMatched - apptModified);
  console.log(`\n   ✅ Appointments Upsert Finished.`);
  console.log(`      - Total Processed:   ${appointmentOps.length}`);
  console.log(`      - Newly Inserted:    ${apptUpserted}`);
  console.log(`      - Updated/Modified:  ${apptModified}`);
  console.log(`      - Unchanged/Ignored: ${apptUnchanged} (already identical)\n`);

  // ---------------------------------------------------------------------------
  // 3. EXTRACT & UPSERT INVENTORY VEHICLES
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("3️⃣  Processing Inventory Collection...");
  console.log("--------------------------------------------------------------------------------");

  // Drop obsolete unique index on stock_1 if present
  try {
    const indexes = await mongoose.connection.db.collection("inventories").indexes();
    const stockIdx = indexes.find((i) => i.name === "stock_1" && i.unique);
    if (stockIdx) {
      console.log("      Adjusting stock_1 index from unique to sparse index...");
      await mongoose.connection.db.collection("inventories").dropIndex("stock_1");
      await mongoose.connection.db.collection("inventories").createIndex({ stock: 1 }, { sparse: true });
    }
  } catch (e) {}

  const vehiclesMap = new Map();
  for (const l of leads) {
    const v = l.vehicle;
    if (v && (v.vehicleId || v.stockNo || v.raw)) {
      const key = String(v.vehicleId || v.stockNo || v.raw);
      if (!vehiclesMap.has(key)) {
        vehiclesMap.set(key, v);
      }
    }
  }

  const inventoryOps = [];
  for (const [key, v] of vehiclesMap.entries()) {
    const identifier = String(v.vehicleId || v.stockNo || key);
    const title = v.raw || [v.year, v.colour, v.make || "BYD", v.model].filter(Boolean).join(" ").trim() || "BYD Vehicle";
    const priceNum = typeof v.price === "number" ? v.price : (parseFloat(String(v.priceRaw || "").replace(/[^0-9.]/g, "")) || null);
    const priceStr = priceNum ? `$${priceNum.toLocaleString()}` : (v.priceRaw || "");

    const invDoc = {
      stock: v.stockNo || "",
      model: v.model || "",
      paint: v.colour || "",
      location: v.yard || "BYD Dealership",
      status: "Available",
      price: priceStr,
      lastSeen: new Date(),
      platform: "virtualyard",

      identifier: identifier,
      networkId: `VY-${identifier}`,
      legacyId: v.stockNo || "",
      itemType: "CAR",
      condition: "New",
      itemStatus: "InStock",
      title: title,
      firstPhotoUrl: null,
      priceData: {
        ui: priceNum,
        currency: "AUD",
        label: "DAP",
      },
      odometer: {
        value: 0,
        unit: "Kilometres",
      },
      registration: {
        rego: null,
        vin: null,
        hin: null,
      },
      specifications: {
        make: v.make || "BYD",
        model: v.model || "",
        badge: null,
        series: null,
        year: v.year || null,
        colour: v.colour || null,
        manufacturerColour: v.colour || null,
      },
      listingStats: {
        enquiryCount: 0,
        watchers: 0,
        retailSearchCount: 0,
        retailViewCount: 0,
        photoCount: 0,
        healthScore: 80,
      },
      lmStats: {
        averageDaysOnMarket: 0,
        averageOdometer: 0,
        marketPercentage: 100,
        averageDriveAwayPrice: priceNum || 0,
        averageWatchers: 0,
        daysOnMarket: 0,
        marketOnline: 0,
        priceRankDap: 1,
        lastUpdated: new Date(),
      },
      onCarsalesNetwork: false,
    };

    inventoryOps.push({
      updateOne: {
        filter: { identifier: identifier, platform: "virtualyard" },
        update: { $set: invDoc },
        upsert: true,
      },
    });
  }

  let invUpserted = 0;
  let invModified = 0;
  let invMatched = 0;

  for (let i = 0; i < inventoryOps.length; i += BATCH_SIZE) {
    const chunk = inventoryOps.slice(i, i + BATCH_SIZE);
    const res = await Inventory.bulkWrite(chunk, { ordered: false });
    invUpserted += res.upsertedCount || 0;
    invModified += res.modifiedCount || 0;
    invMatched += res.matchedCount || 0;
    process.stdout.write(`   ↳ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inventoryOps.length / BATCH_SIZE)} processed (${Math.min(i + BATCH_SIZE, inventoryOps.length)}/${inventoryOps.length})\r`);
  }
  const invUnchanged = Math.max(0, invMatched - invModified);
  console.log(`\n   ✅ Inventory Upsert Finished.`);
  console.log(`      - Total Processed:   ${inventoryOps.length}`);
  console.log(`      - Newly Inserted:    ${invUpserted}`);
  console.log(`      - Updated/Modified:  ${invModified}`);
  console.log(`      - Unchanged/Ignored: ${invUnchanged} (already identical)\n`);

  // ---------------------------------------------------------------------------
  // 4. SUMMARY & VERIFICATION
  // ---------------------------------------------------------------------------
  const [totalLeadsInDb, totalApptsInDb, totalInvInDb] = await Promise.all([
    Lead.countDocuments(),
    Appointment.countDocuments(),
    Inventory.countDocuments(),
  ]);

  console.log("================================================================================");
  console.log("📊  DATABASE SYNC SUMMARY REPORT");
  console.log("================================================================================");
  console.log(`📌 Leads:        ${leadOps.length} processed | ${leadUpserted} new | ${leadModified} updated | ${leadUnchanged} unchanged | Total in DB: ${totalLeadsInDb}`);
  console.log(`📌 Appointments: ${appointmentOps.length} processed | ${apptUpserted} new | ${apptModified} updated | ${apptUnchanged} unchanged | Total in DB: ${totalApptsInDb}`);
  console.log(`📌 Inventory:    ${inventoryOps.length} processed | ${invUpserted} new | ${invModified} updated | ${invUnchanged} unchanged | Total in DB: ${totalInvInDb}`);
  console.log("================================================================================");
  console.log("✨ All data from both.json has been synchronized successfully!\n");
}

if (require.main === module) {
  const customPath = process.argv[2];
  runSeed(customPath)
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("\n❌ Database Upsert Error:", err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}

module.exports = runSeed;
