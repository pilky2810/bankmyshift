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
  driver_required: z.boolean().default(false),
  // null/omitted = no gender requirement on this shift.
  required_gender: z.enum(["male", "female"]).optional().nullable(),
});

// GET /shifts?location=&serviceType=&minPay=&date=
// Always scoped to the signed-in user's company — staff see only open shifts
// (plus their own claimed ones) within that company; managers see everything
// within it, but never another company's shifts.
router.get("/", async (req, res) => {
  const { location, serviceType, minPay, date } = req.query;
  const conditions = ["company_id = $1"];
  const params = [req.user.companyId];

  if (req.user.role === "staff") {
    conditions.push(`(status = 'open' OR claimed_by = $${params.length + 1})`);
    params.push(req.user.id);
  }
  if (location) { params.push(location); conditions.push(`location_name = $${params.length}`); }
  if (serviceType) { params.push(serviceType); conditions.push(`service_type = $${params.length}`); }
  if (minPay) { params.push(Number(minPay)); conditions.push(`pay_rate >= $${params.length}`); }
  if (date) { params.push(date); conditions.push(`date = $${params.length}`); }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const { rows } = await db.query(`SELECT * FROM shifts ${where} ORDER BY date, start_time`, params);
  res.json(rows);
});

// POST /shifts — managers/admins only, always created in their own company
router.post("/", requireRole("manager", "admin"), async (req, res) => {
  const parsed = shiftInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;
  const { rows } = await db.query(
    `INSERT INTO shifts (created_by, company_id, location_name, date, start_time, end_time, service_type, pay_rate, required_skills, notes, mileage_note, approval_required, client_ref, driver_required, required_gender, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'open') RETURNING *`,
    [req.user.id, req.user.companyId, d.location_name, d.date, d.start_time, d.end_time, d.service_type, d.pay_rate, d.required_skills, d.notes || null, d.mileage_note || null, d.approval_required, d.client_ref || null, d.driver_required, d.required_gender || null]
  );
  const shift = rows[0];
  await logAction({ actorId: req.user.id, action: "shift.created", entityType: "shift", entityId: shift.id, metadata: d });

  // Notify all bank-approved staff in the same company who could plausibly cover it.
  const { rows: staffRows } = await db.query(
    `SELECT id FROM users WHERE role = 'staff' AND bank_approved = true AND status = 'active' AND company_id = $1`,
    [req.user.companyId]
  );
  await notificationService.notifyNewShift(shift, staffRows.map((s) => s.id));

  res.status(201).json(shift);
});

// POST /shifts/:id/claim — staff only, and only within their own company
router.post("/:id/claim", requireRole("staff"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1 AND company_id = $2`, [id, req.user.companyId]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Shift not found." });
  if (shift.status !== "open") return res.status(409).json({ error: "This shift is no longer available." });

  const { rows: userRows } = await db.query(`SELECT * FROM users WHERE id = $1`, [req.user.id]);
  const user = userRows[0];
  if (!user.bank_approved) return res.status(403).json({ error: "Your account isn't approved for bank shifts yet." });

  // Driver requirement — purely operational (can't reach a domiciliary visit without
  // transport), so this is a hard block like training.
  if (shift.driver_required && !user.has_driving_licence) {
    return res.status(403).json({ error: "This shift requires a driver with their own transport." });
  }

  // Gender requirement — set by a manager against a specific documented need (see
  // compliance-and-data-protection.md); enforced as a hard block per that decision.
  if (shift.required_gender && user.gender !== shift.required_gender) {
    return res.status(403).json({ error: `This shift requires a ${shift.required_gender} carer.` });
  }

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
  const { rows } = await db.query(
    `SELECT * FROM shifts WHERE id = $1 AND claimed_by = $2 AND company_id = $3`,
    [id, req.user.id, req.user.companyId]
  );
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

  const { rows } = await db.query(
    `SELECT * FROM shifts WHERE id = $1 AND status = 'pending' AND company_id = $2`,
    [id, req.user.companyId]
  );
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

// POST /shifts/:id/cancel — manager/admin cancelling a shift outright.
// Remembers the prior status in previous_status so it can be undone via /reinstate.
router.post("/:id/cancel", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1 AND company_id = $2`, [id, req.user.companyId]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Shift not found." });
  if (shift.status === "cancelled") return res.status(409).json({ error: "This shift is already cancelled." });

  const { rows: updated } = await db.query(
    `UPDATE shifts SET status = 'cancelled', previous_status = status, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  await logAction({ actorId: req.user.id, action: "shift.cancelled", entityType: "shift", entityId: id });

  if (shift.claimed_by) {
    await notificationService.notifyShiftCancelled(shift, shift.claimed_by);
  }

  res.json(updated[0]);
});

// POST /shifts/:id/reinstate — manager/admin undoes a cancellation, restoring
// the exact status (open/pending/confirmed) it had before cancelling.
router.post("/:id/reinstate", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(`SELECT * FROM shifts WHERE id = $1 AND company_id = $2`, [id, req.user.companyId]);
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Shift not found." });
  if (shift.status !== "cancelled") return res.status(409).json({ error: "Only a cancelled shift can be reinstated." });

  const restoredStatus = shift.previous_status || "open";
  const { rows: updated } = await db.query(
    `UPDATE shifts SET status = $1, previous_status = NULL, updated_at = now() WHERE id = $2 RETURNING *`,
    [restoredStatus, id]
  );
  await logAction({ actorId: req.user.id, action: "shift.reinstated", entityType: "shift", entityId: id, metadata: { restoredStatus } });

  if (updated[0].claimed_by) {
    await notificationService.notifyShiftReinstated(updated[0], updated[0].claimed_by);
  }

  res.json(updated[0]);
});

// POST /shifts/:id/handback — staff requests to hand back a shift they're
// already confirmed for. Doesn't release it immediately — goes to the manager's
// Approvals tab for a decision, same review pattern as claiming an
// approval-required shift. (A still-pending, not-yet-approved claim can still be
// withdrawn instantly via /cancel-claim — nothing's been committed to yet there.)
router.post("/:id/handback", requireRole("staff"), async (req, res) => {
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT * FROM shifts WHERE id = $1 AND claimed_by = $2 AND company_id = $3`,
    [id, req.user.id, req.user.companyId]
  );
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "Claim not found." });
  if (shift.status !== "confirmed") {
    return res.status(409).json({ error: "Only a confirmed shift can be handed back for review." });
  }

  const { rows: updated } = await db.query(
    `UPDATE shifts SET status = 'handback_requested', previous_status = status, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  await logAction({ actorId: req.user.id, action: "shift.handback_requested", entityType: "shift", entityId: id });

  const { rows: managerRows } = await db.query(
    `SELECT id FROM users WHERE role IN ('manager', 'admin') AND status = 'active' AND company_id = $1`,
    [req.user.companyId]
  );
  await notificationService.notifyHandbackRequested(updated[0], managerRows.map((m) => m.id), req.user.id);

  res.json(updated[0]);
});

// POST /shifts/:id/handback/decide  { decision: 'approved' | 'rejected' } — manager/admin
router.post("/:id/handback/decide", requireRole("manager", "admin"), async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
  }

  const { rows } = await db.query(
    `SELECT * FROM shifts WHERE id = $1 AND status = 'handback_requested' AND company_id = $2`,
    [id, req.user.companyId]
  );
  const shift = rows[0];
  if (!shift) return res.status(404).json({ error: "No pending hand-back request found for this shift." });

  if (decision === "approved") {
    const { rows: updated } = await db.query(
      `UPDATE shifts SET status = 'open', claimed_by = NULL, previous_status = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    await db.query(
      `UPDATE shift_claims SET status = 'cancelled' WHERE shift_id = $1 AND user_id = $2 AND status = 'approved'`,
      [id, shift.claimed_by]
    );
    await logAction({ actorId: req.user.id, action: "shift.handback_approved", entityType: "shift", entityId: id });
    await notificationService.notifyHandbackApproved(updated[0], shift.claimed_by);
    res.json(updated[0]);
  } else {
    const restoredStatus = shift.previous_status || "confirmed";
    const { rows: updated } = await db.query(
      `UPDATE shifts SET status = $1, previous_status = NULL, updated_at = now() WHERE id = $2 RETURNING *`,
      [restoredStatus, id]
    );
    await logAction({ actorId: req.user.id, action: "shift.handback_denied", entityType: "shift", entityId: id });
    await notificationService.notifyHandbackDenied(updated[0], shift.claimed_by);
    res.json(updated[0]);
  }
});

module.exports = router;
