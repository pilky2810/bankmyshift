const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { hashPassword, verifyPassword, generateResetCode, hashResetCode, verifyResetCode } = require("../utils/password");
const email = require("../services/emailService");
const { logAction } = require("../middleware/auditLog");

const router = express.Router();

// Stricter limits on auth endpoints to slow down credential-stuffing / brute force.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true });
router.use(authLimiter);

function issueToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "12h" }
  );
}

// POST /auth/login
router.post("/login", async (req, res) => {
  const { email: rawEmail, password } = req.body || {};
  if (!rawEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [rawEmail]);
  const user = rows[0];

  // Same generic error whether the email or password is wrong — don't reveal which.
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = issueToken(user);
  await logAction({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      bankApproved: user.bank_approved,
    },
  });
});

// POST /auth/forgot-password  { email }
// Always responds the same way whether or not the account exists, so the
// endpoint can't be used to check which emails are registered.
router.post("/forgot-password", async (req, res) => {
  const { email: rawEmail } = req.body || {};
  if (!rawEmail) return res.status(400).json({ error: "Email is required." });

  const { rows } = await db.query(`SELECT * FROM users WHERE email = $1`, [rawEmail]);
  const user = rows[0];

  if (user) {
    const code = generateResetCode();
    const codeHash = await hashResetCode(code);
    const expiresAt = new Date(Date.now() + (Number(process.env.RESET_TOKEN_EXPIRES_MIN) || 30) * 60 * 1000);

    await db.query(
      `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, codeHash, expiresAt]
    );
    await email.sendPasswordResetEmail(user.email, user.first_name, code);
    await logAction({ actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id });
  }

  res.json({ message: "If that email is registered, a reset code has been sent." });
});

// POST /auth/reset-password  { email, code, newPassword }
router.post("/reset-password", async (req, res) => {
  const { email: rawEmail, code, newPassword } = req.body || {};
  if (!rawEmail || !code || !newPassword) {
    return res.status(400).json({ error: "Email, code, and new password are required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const { rows: userRows } = await db.query(`SELECT * FROM users WHERE email = $1`, [rawEmail]);
  const user = userRows[0];
  if (!user) return res.status(400).json({ error: "Invalid or expired code." });

  const { rows: resetRows } = await db.query(
    `SELECT * FROM password_resets
     WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const resetRecord = resetRows[0];
  if (!resetRecord) return res.status(400).json({ error: "Invalid or expired code." });

  const valid = await verifyResetCode(code, resetRecord.code_hash);
  if (!valid) return res.status(400).json({ error: "Invalid or expired code." });

  const newHash = await hashPassword(newPassword);
  await db.query(`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`, [newHash, user.id]);
  await db.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [resetRecord.id]);
  await logAction({ actorId: user.id, action: "auth.password_reset_completed", entityType: "user", entityId: user.id });

  res.json({ message: "Password updated. You can now sign in." });
});

module.exports = router;
