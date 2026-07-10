const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAction } = require("../middleware/auditLog");
const { hashPassword } = require("../utils/password");
const email = require("../services/emailService");

const router = express.Router();
router.use(requireAuth);

const SAFE_FIELDS = `id, role, first_name, last_name, email, phone, job_role, pay_band, bank_approved, status, created_at, gender, has_driving_licence`;

// GET /staff — manager/admin only: full directory for their own company, including
// each person's current training records (needed so the manager UI can show/edit
// skills — previously this endpoint left that out and only /staff/me had it).
router.get("/", requireRole("manager", "admin"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${SAFE_FIELDS} FROM users WHERE role = 'staff' AND company_id = $1 ORDER BY first_name`,
    [req.user.companyId]
  );
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
  gender: z.enum(["male", "female"]).optional().nullable(),
  hasDrivingLicence: z.boolean().default(false),
});

// POST /staff — manager/admin creates a new staff account in their own company
router.post("/", requireRole("manager", "admin"), async (req, res) => {
  const parsed = newStaffInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const d = parsed.data;

  const passwordHash = await hashPassword(d.temporaryPassword);
  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO users (company_id, role, first_name, last_name, email, phone, job_role, pay_band, password_hash, bank_approved, status, gender, has_driving_licence)
       VALUES ($1,'staff', $2,$3,$4,$5,$6,$7,$8,false,'active',$9,$10) RETURNING ${SAFE_FIELDS}`,
      [req.user.companyId, d.firstName, d.lastName, d.email, d.phone || null, d.jobRole || null, d.payBand || null, passwordHash, d.gender || null, d.hasDrivingLicence]
    ));
  } catch (err) {
    // Postgres unique_violation — surface a clear message instead of the generic
    // 500 the central error handler would otherwise return.
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with this email address already exists." });
    }
    throw err;
  }
  await logAction({ actorId: req.user.id, action: "staff.created", entityType: "user", entityId: rows[0].id });

  // Emails their temp password + a nudge to change it. This is a no-op (just logs a
  // warning) until BREVO_API_KEY/EMAIL_FROM are set — see emailService.js — so
  // account creation always succeeds even if email isn't configured yet.
  await email.sendWelcomeEmail(rows[0].email, rows[0].first_name, d.temporaryPassword);

  res.status(201).json(rows[0]);
});

// PATCH /staff/:id/details — manager/admin edits gender / driver status for an
// existing staff member in their own company (added alongside shift requirements —
// accounts created before this feature default to "not specified" / no driving
// licence until updated).
router.patch("/:id/details", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { gender, hasDrivingLicence } = req.body || {};
  if (gender !== null && gender !== undefined && !["male", "female"].includes(gender)) {
    return res.status(400).json({ error: "gender must be 'male', 'female', or null." });
  }
  const { rows } = await db.query(
    `UPDATE users SET gender = $1, has_driving_licence = $2, updated_at = now() WHERE id = $3 AND role = 'staff' AND company_id = $4 RETURNING ${SAFE_FIELDS}`,
    [gender || null, Boolean(hasDrivingLicence), id, req.user.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  await logAction({ actorId: req.user.id, action: "staff.details_updated", entityType: "user", entityId: id, metadata: { gender: gender || null, hasDrivingLicence: Boolean(hasDrivingLicence) } });
  res.json(rows[0]);
});

// PATCH /staff/:id/approval — toggle bank_approved, scoped to the manager's own company
router.patch("/:id/approval", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { bankApproved } = req.body || {};
  const { rows } = await db.query(
    `UPDATE users SET bank_approved = $1, updated_at = now() WHERE id = $2 AND role = 'staff' AND company_id = $3 RETURNING ${SAFE_FIELDS}`,
    [Boolean(bankApproved), id, req.user.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  await logAction({ actorId: req.user.id, action: "staff.approval_changed", entityType: "user", entityId: id, metadata: { bankApproved: Boolean(bankApproved) } });
  res.json(rows[0]);
});

// POST /staff/:id/training — manager/admin adds or updates a training record.
// Confirms the target staff member is in the manager's own company first —
// otherwise a manager could add/remove training for another company's staff by
// guessing an id, since training_records itself has no company_id column.
router.post("/:id/training", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { trainingType, issuedDate, expiryDate, documentUrl } = req.body || {};
  if (!trainingType) return res.status(400).json({ error: "trainingType is required." });

  const { rows: staffRows } = await db.query(`SELECT id FROM users WHERE id = $1 AND company_id = $2`, [id, req.user.companyId]);
  if (!staffRows[0]) return res.status(404).json({ error: "Staff member not found." });

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
// by mistake). Same company check as above.
router.delete("/:id/training/:trainingType", requireRole("manager", "admin"), async (req, res) => {
  const { id, trainingType } = req.params;
  const { rows: staffRows } = await db.query(`SELECT id FROM users WHERE id = $1 AND company_id = $2`, [id, req.user.companyId]);
  if (!staffRows[0]) return res.status(404).json({ error: "Staff member not found." });

  await db.query(`DELETE FROM training_records WHERE user_id = $1 AND training_type = $2`, [id, trainingType]);
  await logAction({ actorId: req.user.id, action: "staff.training_removed", entityType: "user", entityId: id, metadata: { trainingType } });
  res.json({ message: "Training record removed." });
});

// DELETE /staff/:id — manager/admin "removes" a staff member, scoped to their own company.
// This deactivates the account (status = 'inactive') rather than deleting the row —
// a hard delete would fail or silently break shift history, past claims, and the
// audit log, all of which reference this user and need to stay intact for care-
// record/compliance purposes. A removed account can't log in (see auth.js login,
// which already requires status = 'active') and drops out of the active staff
// directory, but nothing about their history is lost — and it can be undone via
// POST /staff/:id/restore.
router.delete("/:id", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE users SET status = 'inactive', updated_at = now() WHERE id = $1 AND role = 'staff' AND company_id = $2 RETURNING ${SAFE_FIELDS}`,
    [id, req.user.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  await logAction({ actorId: req.user.id, action: "staff.removed", entityType: "user", entityId: id });
  res.json(rows[0]);
});

// POST /staff/:id/restore — manager/admin undoes a removal, reactivating the account.
router.post("/:id/restore", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE users SET status = 'active', updated_at = now() WHERE id = $1 AND role = 'staff' AND company_id = $2 RETURNING ${SAFE_FIELDS}`,
    [id, req.user.companyId]
  );
  if (!rows[0]) return res.status(404).json({ error: "Staff member not found." });
  await logAction({ actorId: req.user.id, action: "staff.restored", entityType: "user", entityId: id });
  res.json(rows[0]);
});

module.exports = router;
