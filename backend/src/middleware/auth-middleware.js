const jwt = require("jsonwebtoken");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Sign in required." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, role, email, companyId, isSuperAdmin }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

// Usage: requireRole('manager', 'admin')
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}

// Platform-level check, separate from company role — used only by the
// "Companies" screen. A user can be a company admin AND a super admin at once.
function requireSuperAdmin(req, res, next) {
  if (!req.user || !req.user.isSuperAdmin) {
    return res.status(403).json({ error: "You don't have permission to do that." });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireSuperAdmin };
