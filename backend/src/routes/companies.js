const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { logAction } = require("../middleware/auditLog");
const { hashPassword } = require("../utils/password");
const email = require("../services/emailService");

const router = express.Router();
router.use(requireAuth, requireSuperAdmin);

// GET /companies — super admin only. Lists every company on the platform, with a
// headcount, so it's easy to see at a glance who's actually using it.
router.get("/", async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.code, c.created_at, COUNT(u.id)::int AS staff_count
     FROM companies c LEFT JOIN users u ON u.company_id = c.id
     GROUP BY c.id ORDER BY c.created_at`
  );
  res.json(rows);
});

const newCompanyInput = z.object({
  name: z.string().min(1),
  // Kept short and URL/UI friendly — lowercased below regardless of what's typed.
  code: z.string().min(2).max(20).regex(/^[a-z0-9-]+$/i, "Company code can only contain letters, numbers, and hyphens."),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
  adminEmail: z.string().email(),
  adminTemporaryPassword: z.string().min(8),
});

// POST /companies — super admin only. Creates a new company AND its first admin
// account in one step, since a company with no admin can't do anything with itself.
// That admin gets the same "here's your temp password" welcome email as any other
// new account (see emailService.js) — they are NOT made a super admin themselves,
// so they can only ever manage their own company.
router.post("/", async (req, res) => {
  const parsed = newCompanyInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;
  const code = d.code.toLowerCase();

  const { rows: existing } = await db.query(`SELECT id FROM companies WHERE code = $1`, [code]);
  if (existing.length) return res.status(409).json({ error: "That company code is already taken." });

  const { rows: companyRows } = await db.query(
    `INSERT INTO companies (name, code) VALUES ($1, $2) RETURNING *`,
    [d.name, code]
  );
  const company = companyRows[0];

  const passwordHash = await hashPassword(d.adminTemporaryPassword);
  let adminRows;
  try {
    ({ rows: adminRows } = await db.query(
      `INSERT INTO users (company_id, role, first_name, last_name, email, password_hash, bank_approved, status)
       VALUES ($1, 'admin', $2, $3, $4, $5, true, 'active')
       RETURNING id, first_name, last_name, email`,
      [company.id, d.adminFirstName, d.adminLastName, d.adminEmail, passwordHash]
    ));
  } catch (err) {
    if (err.code === "23505") {
      // Roll back the company row too — a company with no admin is useless, and
      // leaving it behind would just block the code being tried again.
      await db.query(`DELETE FROM companies WHERE id = $1`, [company.id]);
      return res.status(409).json({ error: "An account with this email address already exists." });
    }
    throw err;
  }
  const admin = adminRows[0];

  await logAction({ actorId: req.user.id, action: "company.created", entityType: "company", entityId: company.id, metadata: { name: d.name, code } });
  await email.sendWelcomeEmail(admin.email, admin.first_name, d.adminTemporaryPassword);

  res.status(201).json({ ...company, staff_count: 1 });
});

module.exports = router;
