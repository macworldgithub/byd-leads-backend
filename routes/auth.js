const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { authenticate, generateToken } = require("../middleware/auth");

// Helper to seed or update Nunawading user
async function seedNunawadingUser() {
  const email = "nunawading@byd.com";
  const password = "123456";
  const site = "BYD Nunawading";

  let user = await User.findOne({ email }).select("+password_hash");
  if (user) {
    user.name = "BYD Nunawading";
    user.role = "agent";
    user.site = site;
    user.locked_site = site;
    user.password_hash = await User.hashPassword(password);
    user.active = true;
    await user.save();
  } else {
    const password_hash = await User.hashPassword(password);
    user = await User.create({
      email,
      name: "BYD Nunawading",
      role: "agent",
      site,
      locked_site: site,
      password_hash,
      active: true,
    });
  }
  return user;
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail, active: true }).select("+password_hash");

    // Auto-seed nunawading user if it doesn't exist yet
    if (!user && cleanEmail === "nunawading@byd.com") {
      user = await seedNunawadingUser();
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    user.last_login_at = new Date();
    await user.save();

    const token = generateToken(user);
    const userObj = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      site: user.site,
      locked_site: user.locked_site,
    };

    res.json({
      success: true,
      access_token: token,
      token_type: "bearer",
      user: userObj,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      site: user.site,
      locked_site: user.locked_site,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/seed ──────────────────────────────────────────────────────
router.post("/seed", async (req, res) => {
  try {
    const user = await seedNunawadingUser();
    res.json({
      success: true,
      message: "Nunawading user seeded successfully",
      email: user.email,
      site: user.site,
      locked_site: user.locked_site,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.seedNunawadingUser = seedNunawadingUser;
