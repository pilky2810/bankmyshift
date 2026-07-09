const cron = require("node-cron");
const db = require("../db");
const notificationService = require("../services/notificationService");

// Runs every 15 minutes; sends a reminder for confirmed shifts starting in
// roughly the next 24 hours that haven't already had a reminder sent.
function startReminderJob() {
  cron.schedule("*/15 * * * *", async () => {
    try {
      const { rows } = await db.query(`
        SELECT s.* FROM shifts s
        WHERE s.status = 'confirmed'
          AND s.claimed_by IS NOT NULL
          AND (s.date + s.start_time) BETWEEN now() AND now() + interval '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.related_shift_id = s.id AND n.type = 'reminder'
          )
      `);

      for (const shift of rows) {
        await notificationService.notifyReminder(shift, shift.claimed_by);
      }

      if (rows.length) console.log(`Reminder job: sent ${rows.length} reminder(s).`);
    } catch (err) {
      console.error("Reminder job failed:", err.message);
    }
  });
}

module.exports = { startReminderJob };
