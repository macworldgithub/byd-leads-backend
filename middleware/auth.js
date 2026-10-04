const jwt = require("jsonwebtoken");

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

const authenticate = (req, res, next) => {
  const decoded = decodeToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, error: "Authentication required" });
  }
  req.user = decoded;
  next();
};

const optionalAuth = (req, res, next) => {
  const decoded = decodeToken(req);
  if (decoded) {
    req.user = decoded;
  }
  next();
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
