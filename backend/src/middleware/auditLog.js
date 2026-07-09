const db = require("../db");

/**
 * Records an entry in audit_log. Call this from route handlers after a
 * state-changing action succeeds — never before, so failed actions aren't logged as done.
 *
 * @param {object} params
 * @param {string} params.actorId - user id performing the action (null for system/cron actions)
 * @param {string} params.action - e.g. 'shift.created', 'claim.approved', 'user.password_reset'
 * @param {string} params.entityType - e.g. 'shift', 'user', 'claim'
 * @param {string} [params.entityId]
 * @param {object} [params.metadata] - before/after values or other context
 */
async function logAction({ actorId, action, entityType, entityId, metadata }) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId || null, action, entityType, entityId || null, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) {
    // Audit logging must never break the primary action — log the failure and move on.
    console.error("Failed to write audit log entry:", err.message);
  }
}

module.exports = { logAction };
