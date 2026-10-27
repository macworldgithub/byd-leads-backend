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
 *   node seed/seed-both.js path/to/both.json --dry-run
 *   node seed/seed-both.js path/to/both.json --backup=before.ejson
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
} catch (e) {}

const fs = require("fs");
const path = require("path");

// Helper to locate both.json
function findBothJson(customPath) {
  if (customPath && fs.existsSync(customPath)) {
    return path.resolve(customPath);
  }
  if (customPath) throw new Error(`Source file does not exist: ${customPath}`);
  const possiblePaths = [
    path.join(__dirname, "../../virtual-yard/Leads/both.json"),
    "d:/sales-floor/virtual-yard/Leads/both.json",
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
    timeZone: "Australia/Melbourne",
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
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (/LOST|CANCEL/.test(status)) return 20;
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete" || stage === "deal") {
    return 95;
  }
  if (hasTestDrive) return 92;
  if (stage === "in_contact" || status.includes("BOOKING") || status.includes("VALUATION")) {
    return 78;
  }
  if (stage === "assigned") {
    return 65;
  }
  return 55;
}

// Helper: Map lead tag
function mapTag(lead, hasTestDrive) {
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (/LOST|CANCEL/.test(status)) return "Contact";
  if (hasTestDrive) return "Commitment";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "deal" || stage === "complete") {
    return "Commitment";
  }
  if (lead.assignedTo && lead.assignedTo !== "Not Assigned") return "Human assisted";
  return "Contact";
}

// Helper: Map lead color
function mapColor(lead, hasTestDrive) {
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (/LOST|CANCEL/.test(status)) return "red";
  if (hasTestDrive) return "green";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "deal" || stage === "complete") {
    return "green";
  }
  if (stage === "in_contact" || lead.tab === "follow_up") return "amber";
  return "blue";
}

// Helper: Map pipeline stage
function mapStage(lead, hasTestDrive) {
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (/LOST|CANCEL/.test(status)) return "LOST";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete") return "DELIVERED";
  if (hasTestDrive || status.includes("BOOKING") || status.includes("TEST DRIVE")) return "TEST DRIVE BOOKED";
  if (stage === "in_contact" || stage === "assigned") return "IN FOLLOW-UP";
  return "NEW ENQUIRIES";
}

// Helper: Map status
function mapStatus(lead, hasTestDrive) {
  const status = (lead.status || "").toUpperCase();
  const stage = (lead.stage || "").toLowerCase();
  if (/LOST|CANCEL/.test(status)) return "lost";
  if (status.includes("ORDER") || status.includes("SIGNED") || status.includes("FINALISE") || stage === "complete") return "sold";
  if (hasTestDrive) return "committed";
  if (stage === "in_contact" || stage === "assigned") return "qualification";
  return "new";
}

async function runSeed(filePath, options = []) {
  return require("./upsert-both").main([...(filePath ? [filePath] : []), ...options]);
}

module.exports = Object.assign(runSeed, { findBothJson, formatAppointmentWhen, calculateScore, mapTag, mapColor, mapStage, mapStatus });

if (require.main === module) {
  require("./upsert-both").main().catch(error => {
    console.error(JSON.stringify({ error: error.name, message: error.message }));
    process.exitCode = 1;
  });
}
