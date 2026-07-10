// One-off migration: adds 'handback_requested' as a valid shift status and a
// previous_status column, so cancelling can be undone (reinstate) and staff
// hand-back requests can go through manager review. schema.sql already has
// these baked in for fresh deploys — this script is only needed because
// migrate.js can't be safely re-run against a database that already exists.
//
// Run once via: npm run add-handback
require("dotenv").config();
const { pool } = require("./db");

async function run() {
  console.log("Adding hand-back / reinstate support...");
  // ALTER TYPE ... ADD VALUE can't run in the same transaction as a statement
  // that uses the new value, but each of these pool.query calls is its own
  // implicit transaction, so this is safe as written.
  await pool.query(`ALTER TYPE shift_status ADD VALUE IF NOT EXISTS 'handback_requested';`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS previous_status shift_status;`);
  console.log("Done — shifts.previous_status is ready, and 'handback_requested' is now a valid status.");
  await pool.end();
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
