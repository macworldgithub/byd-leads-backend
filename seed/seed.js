require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");

const Lead = require("../models/Lead");
const Dealership = require("../models/Dealership");
const Inventory = require("../models/Inventory");
const Conversation = require("../models/Conversation");
const Appointment = require("../models/Appointment");

const leads = [
  {
    name: "SMS Connect Prospect",
    vehicle: "2025 BYD SEAL",
    dealer: "BYD Melbourne City",
    score: 72,
    tag: "Contact",
    color: "blue",
    stage: "AI QUALIFYING",
    source: "SMS Connect",
    phone: "0491 570 201",
    stockNum: "3817",
    control: "AI active",
    receivedDaysAgo: 6,
  },
  {
    name: "Carsalesconnect Prospect",
    vehicle: "2025 BYD SHARK 6",
    dealer: "BYD Fairfield VIC",
    score: 68,
    tag: "Contact",
    color: "blue",
    stage: "AI QUALIFYING",
    source: "Call Connect",
    phone: "0491 570 202",
    stockNum: "4507",
    control: "AI active",
    receivedDaysAgo: 6,
  },
  {
    name: "Carsalesconnect Prospect (2)",
    vehicle: "2025 BYD SHARK 6",
    dealer: "BYD Fairfield VIC",
    score: 90,
    tag: "Commitment",
    color: "green",
    stage: "TEST DRIVE BOOKED",
    source: "Call Connect",
    phone: "0491 570 203",
    stockNum: "4507",
    control: "AI active",
    receivedDaysAgo: 6,
  },
  {
    name: "David Kennedy",
    vehicle: "2026 BYD SHARK 6 Premium",
    dealer: "BYD Fairfield VIC",
    score: 94,
    tag: "Commitment",
    color: "green",
    stage: "TEST DRIVE BOOKED",
    source: "Call Connect",
    phone: "0491 570 204",
    stockNum: "3372",
    control: "Human: Rowland Godeffroy",
    receivedDaysAgo: 6,
  },
  {
    name: "Carsalesconnect Prospect",
    vehicle: "2025 BYD SEALION 8",
    dealer: "BYD Melbourne City",
    score: 58,
    tag: "Contact",
    color: "amber",
    stage: "TEST DRIVE BOOKED",
    source: "Carsales",
    phone: "0491 570 205",
    stockNum: "3455",
    control: "AI active",
    receivedDaysAgo: 7,
  },
];

const dealerships = [
  {
    name: "BYD Fairfield",
    legalEntity: "BYD Fairfield (EAutos Group F)",
    address: "72-74 Grand Avenue, Camellia",
    suburb: "Fairfield",
    state: "NSW",
    phone: "(02) 9724 5088",
    email: "sales@bydfairfield.com.au",
    timezone: "Australia/Sydney",
    smsSenderId: "BYDFairfield",
    autogateId: "AG-FAIRFIELD-001",
    autogateUsername: "greg.dennis@bydfairfield.com",
    autogatePassword: "",
    weekdayHoursStart: "09:00",
    weekdayHoursEnd: "20:00",
    saturdayHoursStart: "09:00",
    saturdayHoursEnd: "17:00",
  },
  {
    name: "BYD Fairfield VIC",
    legalEntity: "BYD Fairfield VIC (EAutos Group V)",
    address: "96 Grange Road, Fairfield",
    suburb: "Fairfield",
    state: "VIC",
    phone: "(03) 9000 1234",
    email: "sales@bydfaifieldvic.com.au",
    timezone: "Australia/Melbourne",
    smsSenderId: "BYDFldVIC",
    autogateId: "AG-FAIRFIELD-VIC-001",
    autogateUsername: "sales@bydfaifieldvic.com.au",
    autogatePassword: "",
    weekdayHoursStart: "09:00",
    weekdayHoursEnd: "20:00",
    saturdayHoursStart: "09:00",
    saturdayHoursEnd: "17:00",
  },
  {
    name: "BYD Melbourne City",
    legalEntity: "BYD Melbourne City (EAutos Group)",
    address: "435 Williamstown Road, Port Melbourne",
    suburb: "Port Melbourne",
    state: "VIC",
    phone: "(03) 9646 9000",
    email: "sales@bydmelbourne.com.au",
    timezone: "Australia/Melbourne",
    smsSenderId: "BYDMelb",
    autogateId: "AG-MELCITY-001",
    autogateUsername: "greg.dennis@bydmelbcity.com",
    autogatePassword: "",
    weekdayHoursStart: "09:00",
    weekdayHoursEnd: "20:00",
    saturdayHoursStart: "09:00",
    saturdayHoursEnd: "17:00",
  },
];

const stockNums = ["6944","6993","6942","6990","6994","6991","7819","2871","7277","8618","8617","9854"];
const paints = ["Apricity White", "Pine Lime", "Cosmos Black", "Arctic Blue"];
const locations = ["BYD Wollongong","BYD Wagga Wagga","BYD Castle Hill","BYD Homebush","BYD Haberfield","BYD Campbelltown"];
const prices = ["$23,990","$24,490","$24,751","$25,490","$25,781","$27,164","$27,681","$28,490"];

const inventory = Array.from({ length: 12 }, (_, i) => ({
  stock: stockNums[i],
  model: `${i % 3 ? "2026" : "2025"} BYD ATTO 1`,
  paint: paints[i % 4],
  location: locations[i % 6],
  status: i % 4 === 2 ? "In Transit" : "Available",
  price: prices[i % 8],
}));

const conversations = [
  {
    prospectName: "Carsalesconnect Prospect",
    phone: "0491 570 204",
    initials: "CP",
    dealer: "BYD Melbourne City",
    status: "Contact",
    control: "Human: Rowland Godfrey",
    lastMessage: "Confirmed — I'll call at 3:30pm today. I've kept stock linked to your enquiry.",
    msgCount: 7,
    daysAgo: 4,
  },
  {
    prospectName: "Carsalesconnect Prospect",
    phone: "0491 570 203",
    initials: "CP",
    dealer: "BYD Fairfield VIC",
    status: "Contact",
    control: "AI active",
    lastMessage: "Of course — I'll keep the enquiry active and monitor availability.",
    msgCount: 5,
    daysAgo: 5,
  },
  {
    prospectName: "Atem Tong (3)",
    phone: "0491 570 202",
    initials: "AT",
    dealer: "BYD Fairfield VIC",
    status: "Commitment",
    control: "AI active",
    lastMessage: "Confirmed — I'll call at 3:30pm today. I've kept stock linked to your enquiry.",
    msgCount: 9,
    daysAgo: 6,
  },
  {
    prospectName: "David Kennedy",
    phone: "0491 570 201",
    initials: "DK",
    dealer: "BYD Fairfield VIC",
    status: "Commitment",
    control: "AI active",
    lastMessage: "Of course — I'll keep the enquiry active and monitor availability.",
    msgCount: 12,
    daysAgo: 7,
  },
  {
    prospectName: "SMS Connect Prospect",
    phone: "0491 570 200",
    initials: "SP",
    dealer: "BYD Melbourne City",
    status: "Commitment",
    control: "AI active",
    lastMessage: "Confirmed — I'll call at 3:30pm today. I've kept stock linked to your enquiry.",
    msgCount: 6,
    daysAgo: 8,
  },
  {
    prospectName: "Carsalesconnect Prospect (2)",
    phone: "0491 570 199",
    initials: "CP",
    dealer: "BYD Fairfield VIC",
    status: "Commitment",
    control: "AI active",
    lastMessage: "Of course — I'll keep the enquiry active and monitor availability.",
    msgCount: 8,
    daysAgo: 9,
  },
];

const appointments = [
  {
    when: "Fri, 28 Aug, 10:30 am",
    prospectName: "Carsalesconnect Prospect",
    phone: "0491 570 204",
    type: "Callback",
    vehicle: "2025 SEALION 8 7 Seat SUV",
    dealership: "BYD Melbourne City",
    bookedBy: "Agent",
    status: "Confirmed",
  },
  {
    when: "Sat, 29 Aug, 06:00 am",
    prospectName: "Carsalesconnect Prospect (2)",
    phone: "0491 570 204",
    type: "Test Drive",
    vehicle: "2025 SHARK 6 Premium Ute Automatic 1.5",
    dealership: "BYD Fairfield VIC",
    bookedBy: "AI",
    status: "Confirmed",
  },
  {
    when: "Sat, 29 Aug, 09:00 am",
    prospectName: "Atem Tong (3)",
    phone: "0491 570 204",
    type: "Test Drive",
    vehicle: "2025 SHARK 6 Premium Ute Automatic 1.5",
    dealership: "BYD Fairfield VIC",
    bookedBy: "AI",
    status: "Confirmed",
  },
  {
    when: "Mon, 31 Aug, 04:30 am",
    prospectName: "David Kennedy",
    phone: "0491 570 204",
    type: "Test Drive",
    vehicle: "—",
    dealership: "BYD Fairfield VIC",
    bookedBy: "AI",
    status: "Confirmed",
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Clear existing data
    await Promise.all([
      Lead.deleteMany({}),
      Dealership.deleteMany({}),
      Inventory.deleteMany({}),
      Conversation.deleteMany({}),
      Appointment.deleteMany({}),
    ]);
    console.log("🗑️  Cleared existing data");

    // Insert seed data
    await Promise.all([
      Lead.insertMany(leads),
      Dealership.insertMany(dealerships),
      Inventory.insertMany(inventory),
      Conversation.insertMany(conversations),
      Appointment.insertMany(appointments),
    ]);

    console.log("🌱 Seed complete:");
    console.log(`   ${leads.length} leads`);
    console.log(`   ${dealerships.length} dealerships`);
    console.log(`   ${inventory.length} inventory items`);
    console.log(`   ${conversations.length} conversations`);
    console.log(`   ${appointments.length} appointments`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
}

seed();
