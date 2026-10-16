const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const { siteConditions } = require('../services/staffDirectory');

// Helper to escape regex
function escapeRegex(str) {
  return typeof str === "string" ? str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
}

// ── GET /api/staff ────────────────────────────────────────────────────────────
// Returns staff members based on user's site access:
// - If user has a locked_site, only staff of that site are returned.
// - If user has full access (super_admin / admin / unlocked), all staff are returned (or filtered by ?site=).
router.get("/", authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user?.role === "super_admin" || req.user?.role === "admin";
    const userLockedSite = req.user?.locked_site || "";
    const hasFullAccess = isSuperAdmin || !userLockedSite;

    const filter = { active: { $ne: false } };

    if (!hasFullAccess) {
      // Locked to specific site
      filter.$or = await siteConditions(User.db, userLockedSite);
    } else if (req.query.site && req.query.site !== "All" && req.query.site !== "All Sites" && req.query.site !== "All Locations") {
      // User with full access filtering by a specific site
      filter.$or = await siteConditions(User.db, req.query.site);
    }

    // Optional text search
    if (req.query.q) {
      const safeQ = escapeRegex(req.query.q.trim());
      const searchOr = [
        { name: { $regex: safeQ, $options: "i" } },
        { email: { $regex: safeQ, $options: "i" } },
        { role: { $regex: safeQ, $options: "i" } },
        { phone: { $regex: safeQ, $options: "i" } },
        { position: { $regex: safeQ, $options: "i" } },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    const staffList = await User.find(filter)
      .select("-password_hash")
      .sort({ name: 1 })
      .lean();

    // Distinct sites for filter dropdown
    let availableSites = [];
    if (hasFullAccess) {
      const distinctSites = await User.distinct("site", { active: { $ne: false } });
      const distinctLocked = await User.distinct("locked_site", { active: { $ne: false } });
      const siteSet = new Set(
        [...distinctSites, ...distinctLocked]
          .filter(Boolean)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      );
      availableSites = Array.from(siteSet).sort();
    }

    res.json({
      success: true,
      data: staffList,
      total: staffList.length,
      userScope: {
        hasFullAccess,
        userSite: userLockedSite || req.user?.site || "All Sites",
      },
      availableSites,
    });
  } catch (err) {
    console.error("Staff route error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
