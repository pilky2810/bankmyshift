const express = require("express");
const { z } = require("zod");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAction } = require("../middleware/auditLog");
const notificationService = require("../services/notificationService");

const router = express.Router();
router.use(requireAuth);

const shiftInput = z.object({
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  location_name: z.string().min(1),
  service_type: z.string().min(1),
  pay_rate: z.number().positive(),
  required_skills: z.array(z.string()).default([]),
  notes: z.string().optional(),
  mileage_note: z.string().optional(),
  approval_required: z.boolean().default(false),
  client_ref: z.string().optional(),
});

// GET /shifts?location=&serviceType=&minPay=&date=
// Staff see only open shifts (plus their own claimed ones); managers see everything.
router.get("/", async (req, res) => {
  const { location, serviceType, minPay, date } = req.query;
  const conditions = [];
  const params = [];

  if (req.user.role === "staff") {
    conditions.push(`(status = 'open' OR claimed_by = $${params.length + 1})`);
    params.push(req.user.id);
  }
  if (location) { params.push(location); conditions.push(`location_name = $${params.length}`); }
  if (serviceType) { params.push(serviceType); conditions.push(`service_type = $${params.length}`); }
  if (minPay) { params.push(Number(minPay)); conditions.push(`pay_rate >= $${params.length}`); }
  if (date) { params.push(date); conditions.push(`date = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await db.query(`SELECT * FROM shifts ${where} ORDER BY date, start_time`, params);
  res.json(rows);
});

// POST /shifts — managers/admins only
router.post("/", requireRole("manager", "admin"), async (req, res) => {
  const parsed = shiftInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;
  const { rows } = await db.query(
    `INSERT INTO shifts (created_by, location_name, date, start_time, end_time, service_type, pay_rate, required_skills, notes, mileage_note, approval_required, client_ref, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open') RETURNING *`,
    [req.user.id, d.location_name, d.date, d.start_time, d.end_time, d.service_type, d.pay_rate, d.required_skills, d.notes || null, d.mileage_note || null, d.approval_required, d.client_ref || null]
  );
  const shift = rows[0];
  await logAction({ actorId: req.user.id, action: "shift.created", entityType: "shift", entityId: shift.id, metadata: d });

  // Notify all bank-approved staff who could plausibly cover it.
  const { rows: staffRows } = await db.query(`SELECT id FROM users WHERE role = 'staff' AND bank_approved = true AND status = 'active'`);
  await notificationService.notifyNewShift(shift, staffRows.map((s) => s.id));

  res.status(201).json(shift);
});

// POST /shifts/:id/claim — staff only
router.post("/:id/claim", requireRole("staff"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1`, [id]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Shift not found." });
  if (shift.status !== "open") return res.status(409).json({ error: "This shift is no longer available." });

  const { rows: userRows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  const user = userRows[0];
  if (!user.bank_approved) return res.status(403).json({ error: "Your account isn't approved for bank shifts yet." });

  // Compliance check — every required skill must exist in the user's training records
  // with no expiry date in the past.
  const { rows: trainingRows } = await db.query(
    `SELECT training_type FROM training_records WHERE user_id = $1 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)`,
    [user.id]
  );
  const heldSkills = new Set(trainingRows.map((t) => t.training_type));
  const missing = shift.required_skills.filter((s) => !heldSkills.has(s));
  if (missing.length) {
    return res.status(403).json({ error: `Missing required training: ${missing.join(", ")}` });
  }

  // Overlap check against the user's other confirmed/pending shifts.
  const { rows: overlapRows } = await db.query(
    `SELECT id FROM shifts
     WHERE claimed_by = $1 AND status IN ('confirmed','pending') AND date = $2
       AND start_time < $3 AND end_time > $4`,
    [user.id, shift.date, shift.end_time, shift.start_time]
  );
  if (overlapRows.length) {
    return res.status(409).json({ error: "This overlaps with another shift you've already claimed." });
  }

  const newStatus = shift.approval_required ? "pending" : "confirmed";
  const { rows: updated } = await db.query(
    `UPDATE shifts SET status = $1, claimed_by = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [newStatus, user.id, id]
  );
  await db.query(
    `INSERT INTO shift_claims (shift_id, user_id, status) VALUES ($1, $2, $3)`,
    [id, user.id, shift.approval_required ? "pending" : "approved"]
  );
  await logAction({ actorId: user.id, action: "shift.claimed", entityType: "shift", entityId: id, metadata: { autoConfirmed: !shift.approval_required } });

  if (!shift.approval_required) {
    await notificationService.notifyClaimApproved(updated[0], user.id);
  }

  res.json(updated[0]);
});

// POST /shifts/:id/cancel-claim — staff cancelling their own claim
router.post("/:id/cancel-claim", requireRole("staff"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1 AND claimed_by = $2`, [id, req.user.id]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Claim not found." });

  await db.query(`UPDATE shifts SET status = 'open', claimed_by = NULL, updated_at = now() WHERE id = $1`, [id]);
  await db.query(`UPDATE shift_claims SET status = 'cancelled' WHERE shift_id = $1 AND user_id = $2 AND status IN ('pending','approved')`, [id, req.user.id]);
  await logAction({ actorId: req.user.id, action: "shift.claim_cancelled", entityType: "shift", entityId: id });

  res.json({ message: "Claim cancelled." });
});

// POST /shifts/:id/decide  { decision: 'approved' | 'rejected' } — manager/admin only
router.post("/:id/decide", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }

  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1 AND status = 'pending'`, [id]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "No pending request found for this shift." });

  const newStatus = decision === "approved" ? "confirmed" : "open";
  const claimedBy = decision === "approved" ? shift.claimed_by : null;

  const { rows: updated } = await db.query(
    `UPDATE shifts SET status = $1, claimed_by = $2, updated_at = now() WHERE id = $3 RETURNING *`,
    [newStatus, claimedBy, id]
  );
  await db.query(
    `UPDATE shift_claims SET status = $1, decided_by = $2, decided_at = now() WHERE shift_id = $3 AND status = 'pending'`,
    [decision, req.user.id, id]
  );
  await logAction({ actorId: req.user.id, action: `claim.${decision}`, entityType: "shift", entityId: id });

  if (decision === "approved") {
    await notificationService.notifyClaimApproved(updated[0], shift.claimed_by);
  } else {
    await notificationService.notifyClaimRejected(shift, shift.claimed_by);
  }

  res.json(updated[0]);
});

// POST /shifts/:id/cancel — manager/admin cancelling a shift outright
router.post("/:id/cancel", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1`, [id]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Shift not found." });

  await db.query(`UPDATE shifts SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  await logAction({ actorId: req.user.id, action: "shift.cancelled", entityType: "shift", entityId: id });

  if (shift.claimed_by) {
    await notificationService.notifyShiftCancelled(shift, shift.claimed_by);
  }

  res.json({ message: "Shift cancelled." });
});

module.exports = router;
