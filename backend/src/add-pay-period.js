// One-off migration: adds a per-company pay period setting (weekly, biweekly,
// four_weekly, or monthly), so each company can configure how their "hours &
// pay" totals are grouped. schema.sql already has this baked in for fresh
// deploys — this script is only needed because migrate.js can't be safely
// re-run against a database that already exists.
//
// Run once via: npm run add-pay-period
require("dotenv").config();
const { pool } = require("./db");

async function run() {
  console.log("Adding pay period support...");
  await pool.query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS pay_period_type TEXT NOT NULL DEFAULT 'weekly';`);
  console.log("Done — companies.pay_period_type is ready (defaults to 'weekly' for existing companies).");
  await pool.end();
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
