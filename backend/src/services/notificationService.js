const db = require("../db");
const email = require("./emailService");

async function recordInApp(userId, type, message, relatedShiftId) {
  await db.query(
    `INSERT INTO notifications (user_id, type, channel, message, related_shift_id)
     VALUES ($1, $2, 'in_app', $3, $4)`,
    [userId, type, message, relatedShiftId || null]
  );
}

async function getUser(userId) {
  const { rows } = await db.query(`SELECT id, first_name, email FROM users WHERE id = $1`, [userId]);
  return rows[0];
}

async function notifyNewShift(shift, recipientUserIds) {
  const message = `New shift posted at ${shift.location_name} — ${shift.date}, ${shift.start_time}–${shift.end_time}.`;
  for (const userId of recipientUserIds) {
    await recordInApp(userId, "new_shift", message, shift.id);
    const user = await getUser(userId);
    if (user) await email.sendNewShiftEmail(user.email, user.first_name, shift);
  }
}

async function notifyClaimApproved(shift, userId) {
  const message = `You're confirmed for ${shift.location_name} on ${shift.date}.`;
  await recordInApp(userId, "approved", message, shift.id);
  const user = await getUser(userId);
  if (user) await email.sendClaimApprovedEmail(user.email, user.first_name, shift);
}

async function notifyClaimRejected(shift, userId) {
  const message = `Your request for ${shift.location_name} on ${shift.date} wasn't approved.`;
  await recordInApp(userId, "rejected", message, shift.id);
  const user = await getUser(userId);
  if (user) await email.sendClaimRejectedEmail(user.email, user.first_name, shift);
}

async function notifyShiftCancelled(shift, userId) {
  const message = `Your shift at ${shift.location_name} on ${shift.date} was cancelled.`;
  await recordInApp(userId, "cancelled", message, shift.id);
  const user = await getUser(userId);
  if (user) await email.sendShiftCancelledEmail(user.email, user.first_name, shift);
}

async function notifyReminder(shift, userId) {
  const message = `Reminder: your shift at ${shift.location_name} starts on ${shift.date} at ${shift.start_time}.`;
  await recordInApp(userId, "reminder", message, shift.id);
  const user = await getUser(userId);
  if (user) await email.sendReminderEmail(user.email, user.first_name, shift);
}

module.exports = {
  notifyNewShift,
  notifyClaimApproved,
  notifyClaimRejected,
  notifyShiftCancelled,
  notifyReminder,
};
