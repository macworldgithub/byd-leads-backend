const express = require("express");
const router = express.Router();
const Inventory = require("../models/Inventory");
const { inventoryScope, queryKey } = require('../services/inventoryScope');

// ── In-Memory Cache for Stats and Filters (High Performance) ─────────────────
const filtersCache = new Map();
const statsCache = new Map();

function invalidateCache() {
  filtersCache.clear();
  statsCache.clear();
}

function cacheResult(cache, key, value, duration) {
  if (cache.size >= 100) cache.clear();
  cache.set(key, { value, expires: Date.now() + duration });
  return value;
}

// Helper to escape regex special characters
function escapeRegex(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLocationQuery(locVal) {
  if (!locVal || ["all", "all locations", "all yards", "all sites"].includes(String(locVal).toLowerCase().trim())) {
    return null;
  }
  const cleanVal = String(locVal).replace(/^BYD\s+/i, "").replace(/^DENZA\s+/i, "").trim();
  const escaped = escapeRegex(cleanVal);
  const rawEscaped = escapeRegex(String(locVal).trim());

  const regexes = [
    new RegExp(escaped, "i"),
    new RegExp(rawEscaped, "i"),
  ];
  if (/caroline/i.test(cleanVal)) {
    regexes.push(/caroline/i);
    regexes.push(/\bcs\b/i);
  }
  if (/melbourne/i.test(cleanVal)) {
    regexes.push(/melbourne/i);
    regexes.push(/\bcbd\b/i);
  }
  if (/fairfield/i.test(cleanVal)) {
    regexes.push(/fairfield/i);
    regexes.push(/\bffd\b/i);
  }
  if (/nunawading/i.test(cleanVal)) {
    regexes.push(/nunawading/i);
    regexes.push(/\bnwd\b/i);
  }
  if (/wodonga/i.test(cleanVal)) {
    regexes.push(/wodonga/i);
    regexes.push(/\bwdg\b/i);
  }
  if (/doncaster/i.test(cleanVal)) {
    regexes.push(/doncaster/i);
    regexes.push(/\bdc\b/i);
  }
  if (/holding/i.test(cleanVal)) {
    regexes.push(/holding/i);
    regexes.push(/derrimut/i);
  }

  const orClauses = [];
  for (const reg of regexes) {
    orClauses.push({ location: reg });
    orClauses.push({ orderYard: reg });
    orClauses.push({ "shirleyData.outBoundStore": reg });
  }
  return { $or: orClauses };
}

function buildStatusQuery(statusVal) {
  if (!statusVal || ["all", "all statuses", "all status"].includes(String(statusVal).toLowerCase().trim())) {
    return null;
  }
  const s = String(statusVal).trim().toLowerCase();
  if (s === "available" || s === "in stock" || s === "instock") {
    return {
      $or: [
        { status: { $regex: /^in\s*stock$/i } },
        { status: /^available$/i },
        { itemStatus: /^instock$/i },
      ]
    };
  }
  if (s === "delivered") {
    return { status: { $regex: /^deliver/i } };
  }
  if (s === "sold") {
    return { status: { $regex: /^sold$/i } };
  }
  if (s === "in transit") {
    return {
      $or: [
        { status: { $regex: /^in\s*transit$/i } },
        { itemStatus: { $regex: /^in\s*transit$/i } },
      ]
    };
  }
  if (s === "demo") {
    return {
      $or: [
        { status: { $regex: /^demo$/i } },
        { condition: /^demo$/i },
      ]
    };
  }
  if (s === "display") {
    return { status: { $regex: /^display$/i } };
  }
  if (s === "damage" || s === "damaged") {
    return { status: { $regex: /^damage/i } };
  }
  if (s === "on hold" || s === "on-hold" || s === "held") {
    return { status: { $regex: /^on[- ]?hold$|^held$/i } };
  }
  if (s === "allocated") {
    return { status: { $regex: /^allocated$/i } };
  }
  return { status: { $regex: new RegExp(`^${escapeRegex(statusVal)}$`, "i") } };
}

// ── Fast Cached Summary Stats ────────────────────────────────────────────────
async function getSummaryStats(filter) {
  const now = Date.now();
  const key = queryKey(filter);
  const cached = statsCache.get(key);
  if (cached && now < cached.expires) {
    return cached.value;
  }
  try {
    const [raw] = await Inventory.collection.aggregate([
      { $match: filter },
      {
        $facet: {
          total: [{ $count: "count" }],
          inStock: [{ $match: { status: { $in: ["In Stock", "Available", "InStock"] } } }, { $count: "count" }],
          delivered: [{ $match: { status: { $regex: /^deliver/i } } }, { $count: "count" }],
          inTransit: [{ $match: { status: { $regex: /^in\s*transit/i } } }, { $count: "count" }],
          demo: [{ $match: { $or: [{ status: /^demo$/i }, { condition: /^demo$/i }] } }, { $count: "count" }],
          shirley: [{ $match: { platform: "shirley" } }, { $count: "count" }],
          virtualyard: [{ $match: { platform: "virtualyard" } }, { $count: "count" }],
          autogate: [{ $match: { platform: "autogate" } }, { $count: "count" }],
        },
      },
    ]).toArray();

    const stats = {
      total: raw.total[0]?.count || 0,
      inStock: raw.inStock[0]?.count || 0,
      delivered: raw.delivered[0]?.count || 0,
      inTransit: raw.inTransit[0]?.count || 0,
      demo: raw.demo[0]?.count || 0,
      shirley: raw.shirley[0]?.count || 0,
      virtualyard: raw.virtualyard[0]?.count || 0,
      autogate: raw.autogate[0]?.count || 0,
    };
    return cacheResult(statsCache, key, stats, 60 * 1000);
  } catch (err) {
    return {
      total: 0,
      inStock: 0,
      delivered: 0,
      inTransit: 0,
      demo: 0,
      shirley: 0,
      virtualyard: 0,
      autogate: 0,
    };
  }
}

// ── GET /api/inventory/filters ───────────────────────────────────────────────
router.get("/filters", async (req, res) => {
  try {
    const scope = inventoryScope(req.user);
    const key = queryKey(scope.filter);
    const now = Date.now();
    const cached = filtersCache.get(key);
    if (cached && now < cached.expires) {
      return res.json(cached.value);
    }

    const [locations, orderYards, models, legacyModels, statuses, platforms] = await Promise.all([
      Inventory.distinct("location", scope.filter),
      Inventory.distinct("orderYard", scope.filter),
      Inventory.distinct("specifications.model", scope.filter),
      Inventory.distinct("model", scope.filter),
      Inventory.distinct("status", scope.filter),
      Inventory.distinct("platform", scope.filter),
    ]);

    const cleanLocs = Array.from(new Set([...locations, ...orderYards]))
      .filter((l) => l && l !== "#N/A" && l !== "_" && l.length > 1)
      .sort();

    const cleanModels = Array.from(new Set([...models, ...legacyModels]))
      .filter((m) => m && m.length > 1)
      .sort();

    const filters = {
      locations: scope.site ? [scope.site] : cleanLocs,
      statuses: statuses.filter(Boolean).sort(),
      models: cleanModels,
      platforms: platforms.filter(Boolean).sort(),
      site: scope.site,
    };
    cacheResult(filtersCache, key, filters, 5 * 60 * 1000);
    res.json(filters);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── GET /api/inventory/stats ─────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const stats = await getSummaryStats(inventoryScope(req.user).filter);
    res.json(stats);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── GET /api/inventory ─────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const {
      model,
      status,
      location,
      yard,
      dealer,
      site,
      condition,
      platform,
      q,
      page = 1,
      limit = 25,
      paginated,
    } = req.query;

    const scope = inventoryScope(req.user);
    const andClauses = Object.keys(scope.filter).length ? [scope.filter] : [];

    // Model filter
    if (model && model !== "all" && model !== "All Models" && model !== "All") {
      const safeModel = escapeRegex(model);
      andClauses.push({
        $or: [
          { model: { $regex: safeModel, $options: "i" } },
          { "specifications.model": { $regex: safeModel, $options: "i" } },
          { title: { $regex: safeModel, $options: "i" } },
        ],
      });
    }

    // Status filter
    const statusQuery = buildStatusQuery(status);
    if (statusQuery) {
      andClauses.push(statusQuery);
    }

    // Yard / Location filter
    const locVal = location || yard || dealer || site;
    const locQuery = buildLocationQuery(locVal);
    if (locQuery) {
      andClauses.push(locQuery);
    }

    // Condition filter
    if (condition && condition !== "all" && condition !== "All") {
      andClauses.push({ condition });
    }

    // Platform filter
    if (platform && platform !== "all" && platform !== "All") {
      andClauses.push({ platform });
    }

    // Free text search
    if (q) {
      const safeQ = escapeRegex(q);
      andClauses.push({
        $or: [
          { stock: { $regex: safeQ, $options: "i" } },
          { model: { $regex: safeQ, $options: "i" } },
          { paint: { $regex: safeQ, $options: "i" } },
          { location: { $regex: safeQ, $options: "i" } },
          { orderYard: { $regex: safeQ, $options: "i" } },
          { title: { $regex: safeQ, $options: "i" } },
          { identifier: { $regex: safeQ, $options: "i" } },
          { "registration.rego": { $regex: safeQ, $options: "i" } },
          { "registration.vin": { $regex: safeQ, $options: "i" } },
          { "shirleyData.salesConsultant": { $regex: safeQ, $options: "i" } },
          { "shirleyData.poNumber": { $regex: safeQ, $options: "i" } },
        ],
      });
    }

    const filter = andClauses.length > 0 ? (andClauses.length === 1 ? andClauses[0] : { $and: andClauses }) : {};

    // Bound page and limit to prevent massive memory dumps
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 25));
    const skip = (pageNum - 1) * pageSize;

    // Fast indexed query with lean()
    const [items, total, stats] = await Promise.all([
      Inventory.find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      Inventory.countDocuments(filter),
      getSummaryStats(scope.filter),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;

    res.setHeader("X-Total-Count", total);

    // Return comprehensive paginated response
    return res.json({
      success: true,
      data: items,
      total,
      page: pageNum,
      totalPages,
      limit: pageSize,
      stats,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST create inventory item
router.post("/", async (req, res) => {
  try {
    const item = await Inventory.create(req.body);
    invalidateCache();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update inventory item
router.put("/:id", async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ error: "Inventory item not found" });
    invalidateCache();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
