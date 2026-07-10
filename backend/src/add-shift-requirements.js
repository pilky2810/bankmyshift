// One-off migration: adds the new gender/driver requirement columns to an
// already-live database (schema.sql already has these baked in for fresh
// deploys — this script is only needed because migrate.js can't be safely
// re-run against a database that already has its tables).
//
// Run once via: npm run add-requirements
require("dotenv").config();
const { pool } = require("./db");

async function run() {
  console.log("Adding shift/staff requirement columns...");
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_driving_licence BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS driver_required BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS required_gender TEXT;`);
  console.log("Done — users.gender, users.has_driving_licence, shifts.driver_required, shifts.required_gender are ready.");
  await pool.end();
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
