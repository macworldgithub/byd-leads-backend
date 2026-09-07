/**
 * seed-virtualyard.js
 * Non-destructive import of Virtualyard data (leads, test drives, inventory) from both.json.
 * Uses upsert operations so it is safe to run multiple times without duplicate records.
 *
 * Usage:
 *   node seed/seed-virtualyard.js
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
const Inventory = require("../models/Inventory");

function findBothJson() {
  const possiblePaths = [
    path.join(__dirname, "../../both.json"),
    path.join(__dirname, "../both.json"),
    path.join(__dirname, "both.json"),
    path.resolve("both.json"),
    path.resolve("../both.json"),
    "d:/byd-leads-new/both.json",
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error("Could not find both.json file in any expected path.");
}

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

function mapTag(lead, hasTestDrive) {
  if (hasTestDrive) return "Commitment";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("LOST") || status.includes("CANCELLED")) return "Opted Out";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "deal" || stage === "complete") {
    return "Commitment";
  }
  if (lead.assignedTo) return "Human assisted";
  return "Contact";
}

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

function mapStatus(lead, hasTestDrive) {
  if (hasTestDrive) return "committed";
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete") return "sold";
  if (status.includes("LOST") || status.includes("CANCELLED")) return "lost";
  if (stage === "in_contact" || stage === "assigned") return "qualification";
  return "new";
}

async function seedVirtualyard() {
  const jsonPath = findBothJson();
  console.log(`[1/4] Reading data from: ${jsonPath}`);
  const rawData = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const leads = rawData.leads || [];
  const testDrives = rawData.testDrives || [];
  console.log(`      Found ${leads.length} leads and ${testDrives.length} test drives.`);

  // Build test drives lookup map by leadId
  const testDrivesMap = new Map();
  testDrives.forEach((td) => {
    if (td.leadId) {
      testDrivesMap.set(String(td.leadId), td);
    }
  });

  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/byd_leads_crm";
  console.log(`[2/4] Connecting to MongoDB (${uri.replace(/:([^:@]+)@/, ":****@")})...`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log("      Connected successfully.");

  // ── 1. UPSERT LEADS ────────────────────────────────────────────────────────
  console.log(`[3/4] Preparing and upserting leads...`);
  const leadOps = [];
  const processedLeadIds = new Set();

  for (const item of leads) {
    const leadId = String(item.leadId || item._id);
    processedLeadIds.add(leadId);
    const linkedTd = testDrivesMap.get(leadId);
    const hasTestDrive = Boolean(linkedTd);

    const cust = item.customer || {};
    const fullName = cust.fullName || [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim() || (linkedTd?.customer?.fullName) || "Prospect";
    const phone = cust.phone || cust.mobilePhone || cust.homePhone || linkedTd?.customer?.phone || "";
    const email = cust.email || linkedTd?.customer?.email || "";

    const veh = item.vehicle || {};
    const vehicleStr = veh.raw || [veh.year, veh.colour, veh.make || "BYD", veh.model].filter(Boolean).join(" ").trim() || "BYD Vehicle";
    const dealerStr = veh.yard || linkedTd?.location || "BYD Dealership";
    const stockNum = veh.stockNo || "";
    const priceStr = veh.price ? `$${Number(veh.price).toLocaleString()}` : (veh.priceRaw || "");

    const score = calculateScore(item, hasTestDrive);
    const tag = mapTag(item, hasTestDrive);
    const color = mapColor(item, hasTestDrive);
    const stage = mapStage(item, hasTestDrive);
    const status = mapStatus(item, hasTestDrive);

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
      control: item.assignedTo ? `Assigned: ${item.assignedTo}` : "AI active",
      notes: item.previewText || "",
      enquiryDesc: item.previewText || `Virtual Yard enquiry - ${item.status || "NEW"}`,
      enquiryNote: item.status ? `Status: ${item.status} | Stage: ${item.stageText || item.stage}` : "",
      price: priceStr,
      paintColor: veh.colour || "",
      platform: "virtualyard",

      virtualyardId: leadId,
      customerId: item.customerId ? String(item.customerId) : null,
      vyStage: item.stage || "",
      vyStageText: item.stageText || "",
      vyTab: item.tab || "",
      vyStatus: item.status || "",
      assignedTo: item.assignedTo || "",
      lastContact: item.lastContact || "",
      leadDate: item.leadDate ? new Date(item.leadDate) : null,
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
        filter: { virtualyardId: leadId },
        update: { $set: doc },
        upsert: true,
      },
    });
  }

  // Also include unmatched test drives as leads so no bookings are lost
  let unmatchedTdCount = 0;
  for (const td of testDrives) {
    const tdLeadId = String(td.leadId);
    if (!processedLeadIds.has(tdLeadId)) {
      unmatchedTdCount++;
      const cust = td.customer || {};
      const fullName = cust.fullName || [cust.firstName, cust.lastName].filter(Boolean).join(" ").trim() || "Test Drive Prospect";
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

        virtualyardId: `td-${td._id || td.leadId}`,
        customerId: null,
        vyStage: "assigned",
        vyStageText: "Test Drive Confirmed",
        vyTab: "inbox",
        vyStatus: "TEST DRIVE",
        assignedTo: "",
        lastContact: "",
        leadDate: td.testDriveDate ? new Date(td.testDriveDate) : new Date(),
        testDrive: {
          testDriveDate: td.testDriveDate ? new Date(td.testDriveDate) : null,
          location: td.location || "",
          status: td.status || "Confirmed",
          confirmed: true,
        },
      };

      leadOps.push({
        updateOne: {
          filter: { virtualyardId: `td-${td._id || td.leadId}` },
          update: { $set: doc },
          upsert: true,
        },
      });
    }
  }

  // Execute lead bulkWrite in batches of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < leadOps.length; i += BATCH_SIZE) {
    const chunk = leadOps.slice(i, i + BATCH_SIZE);
    await Lead.bulkWrite(chunk);
    console.log(`      Upserted leads batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(leadOps.length / BATCH_SIZE)} (${chunk.length} records)`);
  }
  console.log(`      ✅ Total leads upserted: ${leadOps.length} (${unmatchedTdCount} standalone test-drive leads added).`);

  // ── 2. EXTRACT & UPSERT INVENTORY VEHICLES ────────────────────────────────
  console.log(`[4/4] Extracting and upserting unique inventory vehicles...`);

  // Drop obsolete unique index on stock_1 if it exists so multi-platform inventory coexists safely
  try {
    const indexes = await mongoose.connection.db.collection("inventories").indexes();
    const stockIdx = indexes.find((i) => i.name === "stock_1" && i.unique);
    if (stockIdx) {
      console.log("      Updating stock_1 index from unique to standard sparse index...");
      await mongoose.connection.db.collection("inventories").dropIndex("stock_1");
      await mongoose.connection.db.collection("inventories").createIndex({ stock: 1 }, { sparse: true });
    }
  } catch (e) {
    // Ignore if already dropped
  }

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

  for (let i = 0; i < inventoryOps.length; i += BATCH_SIZE) {
    const chunk = inventoryOps.slice(i, i + BATCH_SIZE);
    await Inventory.bulkWrite(chunk);
    console.log(`      Upserted inventory batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inventoryOps.length / BATCH_SIZE)} (${chunk.length} vehicles)`);
  }
  console.log(`      ✅ Total unique vehicles upserted: ${inventoryOps.length}`);

  console.log("\n🎉 Virtualyard seeding completed successfully!");
  await mongoose.disconnect();
}

seedVirtualyard().catch((err) => {
  console.error("❌ Seeding failed:", err.message);
  process.exit(1);
});
