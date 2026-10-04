require("dotenv").config();
const mongoose = require("mongoose");
const { seedNunawadingUser } = require("../routes/auth");

async function run() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/byd_leads_crm";
  console.log("Connecting to:", uri.replace(/\/\/.*@/, "//***@"));
  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const user = await seedNunawadingUser();
  console.log("✅ Seeded/Updated User:");
  console.log("   Email:       ", user.email);
  console.log("   Name:        ", user.name);
  console.log("   Site:        ", user.site);
  console.log("   Locked Site: ", user.locked_site);
  console.log("   Password:     123456");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
