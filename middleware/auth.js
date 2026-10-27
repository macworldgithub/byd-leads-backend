const jwt = require("jsonwebtoken");
const { hasPlatform, resolveSite, guardResourceSite } = require('../services/accountAccess');

const JWT_SECRET = process.env.JWT_SECRET || "byd_lead_centre_secret_2026";

const decodeToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split(" ")[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const authenticate = async (req, res, next) => {
  const decoded = decodeToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }
  try {
    const User = require('../models/User');
    const account = await User.findById(decoded.id).lean();
    if (!account || account.active === false || account.deleted_at || (decoded.auth_version || 0) !== (account.auth_version || 0)) return res.status(401).json({ success: false, error: 'Session revoked. Please sign in again.' });
    if (!hasPlatform(account, 'lead_centre')) return res.status(403).json({ success: false, error: 'Lead Centre access is not assigned to this account.' });
    const requested = req.headers['x-site'] || req.query.dealer || req.query.site || req.query.yard || req.query.location || req.body?.dealer;
    req.user = { ...decoded, id: String(account._id), name: account.name, email: account.email, role: account.role, site: account.site,
      locked_site: resolveSite(account, requested), allowed_sites: account.allowed_sites, all_sites: account.all_sites };
    await guardResourceSite(req, User.db);
    return enforceSiteLock(req, res, next);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: error.message });
    next(error);
  }
};

const optionalAuth = (req, res, next) => {
  if (req.headers.authorization) return authenticate(req, res, next);
  return next();
};

const enforceSiteLock = (req, res, next) => {
  const locked = req.user?.locked_site;
  if (!locked) return next();

  // Enforce locked site on all query parameters
  req.query.dealer = locked;
  req.query.location = locked;
  req.query.yard = locked;
  req.query.site = locked;

  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    if (req.body.dealer !== undefined || req.method === "POST") {
      req.body.dealer = locked;
    }
  }

  next();
};

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id?.toString() || user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      site: user.site || "",
      locked_site: user.locked_site || "",
      auth_version: user.auth_version || 0,
      platform: 'lead_centre',
      allowed_sites: user.allowed_sites,
      all_sites: user.all_sites,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
  );
};

module.exports = {
  authenticate,
  optionalAuth,
  enforceSiteLock,
  generateToken,
};
