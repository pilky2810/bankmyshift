// One-off migration: turns the single-tenant database into a multi-tenant one.
// schema.sql already has all of this baked in for fresh deploys — this script is
// only needed because migrate.js can't be safely re-run against a database that
// already exists.
//
// What it does, in order:
//   1. Creates the `companies` table.
//   2. Creates a company for the existing data: Frank House Care Services / code "fhcs".
//   3. Adds company_id to users and shifts (nullable at first).
//   4. Backfills every existing user/shift onto the "fhcs" company.
//   5. Makes company_id NOT NULL now that every row has one.
//   6. Adds is_super_admin to users, and flags the FIRST_ADMIN below as one, so
//      they can access the new "Companies" screen and create further companies.
//
// Run once via: npm run add-multi-tenant
require("dotenv").config();
const { pool } = require("./db");

// Change this if your existing admin account uses a different email.
const SUPER_ADMIN_EMAIL = "lawrence.pilkington@fhcsltd.co.uk";
const FIRST_COMPANY_NAME = "Frank House Care Services";
const FIRST_COMPANY_CODE = "fhcs";

async function run() {
  console.log("Adding multi-tenant support...");

  await pool.query(`CREATE EXTENSION IF NOT EXISTS "citext";`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      code CITEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log("companies table ready.");

  await pool.query(
    `INSERT INTO companies (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING;`,
    [FIRST_COMPANY_NAME, FIRST_COMPANY_CODE]
  );
  const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE code = $1`, [FIRST_COMPANY_CODE]);
  const firstCompanyId = companyRows[0].id;
  console.log(`"${FIRST_COMPANY_NAME}" company ready (code: ${FIRST_COMPANY_CODE}).`);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);`);

  await pool.query(`UPDATE users SET company_id = $1 WHERE company_id IS NULL;`, [firstCompanyId]);
  await pool.query(`UPDATE shifts SET company_id = $1 WHERE company_id IS NULL;`, [firstCompanyId]);
  console.log("Existing users and shifts backfilled onto the first company.");

  await pool.query(`ALTER TABLE users ALTER COLUMN company_id SET NOT NULL;`);
  await pool.query(`ALTER TABLE shifts ALTER COLUMN company_id SET NOT NULL;`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shifts_company ON shifts(company_id);`);

  const { rowCount } = await pool.query(
    `UPDATE users SET is_super_admin = true WHERE email = $1;`,
    [SUPER_ADMIN_EMAIL]
  );
  if (rowCount) {
    console.log(`${SUPER_ADMIN_EMAIL} marked as a super admin — they'll see the "Companies" screen after their next login.`);
  } else {
    console.warn(`Couldn't find a user with email ${SUPER_ADMIN_EMAIL} — no one was marked as a super admin. Edit SUPER_ADMIN_EMAIL at the top of this file and re-run if needed.`);
  }

  console.log("Done — multi-tenant support is ready. Everyone will need their company's code (\"fhcs\" for the existing company) to log in from now on.");
  await pool.end();
}

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
