const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAction } = require("../middleware/auditLog");
const { hashPassword } = require("../utils/password");

const router = express.Router();
router.use(requireAuth);

const SAFE_FIELDS = `id, role, first_name, last_name, email, phone, job_role, pay_band, bank_approved, status, created_at`;

// GET /staff — manager/admin only: full directory, including each person's
// current training records (needed so the manager UI can show/edit skills —
// previously this endpoint left that out and only /staff/me had it).
router.get("/", requireRole("manager", "admin"), async (req, res) => {
  const { rows } = await db.query(`SELECT ${SAFE_FIELDS} FROM users WHERE role = 'staff' ORDER BY first_name`);
  const ids = rows.map((r) => r.id);

  let trainingByUser = {};
  if (ids.length) {
    const { rows: trainingRows } = await db.query(
      `SELECT user_id, training_type, issued_date, expiry_date FROM training_records WHERE user_id = ANY($1)`,
      [ids]
    );
    for (const t of trainingRows) {
      if (!trainingByUser[t.user_id]) trainingByUser[t.user_id] = [];
      trainingByUser[t.user_id].push({ training_type: t.training_type, issued_date: t.issued_date, expiry_date: t.expiry_date });
    }
  }

  res.json(rows.map((r) => ({ ...r, training: trainingByUser[r.id] || [] })));
});

// GET /staff/me — any authenticated user, their own profile + training records
router.get("/me", async (req, res) => {
  const { rows } = await db.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
  const { rows: training } = await db.query(`SELECT training_type, issued_date, expiry_date FROM training_records WHERE user_id = $1`, [req.user.id]);
  res.json({ ...rows[0], training });
});

const newStaffInput = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  jobRole: z.string().optional(),
  payBand: z.string().optional(),
  temporaryPassword: z.string().min(8),
});

// POST /staff — manager/admin creates a new staff account
router.post("/", requireRole("manager", "admin"), async (req, res) => {
  const parsed = newStaffInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const passwordHash = await hashPassword(d.temporaryPassword);
  const { rows } = await db.query(
    `INSERT INTO users (role, first_name, last_name, email, phone, job_role, pay_band, password_hash, bank_approved, status)
     VALUES ('staff', $1,$2,$3,$4,$5,$6,$7,false,'active') RETURNING ${SAFE_FIELDS}`,
    [d.firstName, d.lastName, d.email, d.phone || null, d.jobRole || null, d.payBand || null, passwordHash]
  );
  await logAction({ actorId: req.user.id, action: "staff.created", entityType: "user", entityId: rows[0].id });
  res.status(201).json(rows[0]);
});

// PATCH /staff/:id/approval — toggle bank_approved
router.patch("/:id/approval", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { bankApproved } = req.body || {};
  const { rows } = await db.query(
    `UPDATE users SET bank_approved = $1, updated_at = now() WHERE id = $2 AND role = 'staff' RETURNING ${SAFE_FIELDS}`,
    [Boolean(bankApproved), id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  await logAction({ actorId: req.user.id, action: "staff.approval_changed", entityType: "user", entityId: id, metadata: { bankApproved: Boolean(bankApproved) } });
  res.json(rows[0]);
});

// POST /staff/:id/training — manager/admin adds or updates a training record
router.post("/:id/training", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { trainingType, issuedDate, expiryDate, documentUrl } = req.body || {};
  if (!trainingType) return res.status(400).json({ error: "trainingType is required." });

  const { rows } = await db.query(
    `INSERT INTO training_records (user_id, training_type, issued_date, expiry_date, document_url)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, trainingType, issuedDate || null, expiryDate || null, documentUrl || null]
  );
  await logAction({ actorId: req.user.id, action: "staff.training_updated", entityType: "user", entityId: id, metadata: { trainingType } });
  res.status(201).json(rows[0]);
});

// DELETE /staff/:id/training/:trainingType — manager/admin removes a training record
// (used when unticking a skill in the manager UI — e.g. a cert lapsed or was entered
// by mistake).
router.delete("/:id/training/:trainingType", requireRole("manager", "admin"), async (req, res) => {
  const { id, trainingType } = req.params;
  await db.query(`DELETE FROM training_records WHERE user_id = $1 AND training_type = $2`, [id, trainingType]);
  await logAction({ actorId: req.user.id, action: "staff.training_removed", entityType: "user", entityId: id, metadata: { trainingType } });
  res.json({ message: "Training record removed." });
});

module.exports = router;
