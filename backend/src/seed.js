require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./db");

// Edit these before running `npm run seed` for your organisation.
const FIRST_COMPANY = {
  name: "Frank House Care Services",
  code: "fhcs", // what everyone types at login, alongside their email + password
};

const FIRST_ADMIN = {
  firstName: "Lawrence",
  lastName: "Pilkington",
  email: "lawrence.pilkington@fhcsltd.co.uk",
  phone: "077777777777",
  password: "Willow-Marble-4430!", // the admin should change this on first login
  jobRole: "Rota Coordinator",
};

// Additional manager accounts — added after go-live, so they don't get the
// `bank_approved` field: managers don't claim shifts, so it's irrelevant for them,
// but the column is NOT NULL, hence `true` below (matches how staff-approval works
// for the admin account too).
const MANAGERS = [
  {
    firstName: "Paige",
    lastName: "Ellis",
    email: "paige.ellis@fhcsltd.co.uk",
    phone: "01254643611",
    password: "Birch-Otter-5227!", // change on first login
    jobRole: "Care Coordinator",
  },
  {
    firstName: "Alisha",
    lastName: "Finn",
    email: "alisha.finn@fhcsltd.co.uk",
    phone: "01254643611",
    password: "Otter-Cobalt-5108!", // change on first login
    jobRole: "Care Coordinator",
  },
];

// NOTE: placeholder locations kept for the pilot per FHCS's instruction — replace
// with real site names before wider rollout.
const LOCATIONS = [
  { name: "Willowbrook House", region: "North" },
  { name: "Oakfield Lodge", region: "North" },
  { name: "Meadow View", region: "South" },
  { name: "Riverside Ward (Domiciliary)", region: "South" },
];

async function seed() {
  await pool.query(
    `INSERT INTO companies (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
    [FIRST_COMPANY.name, FIRST_COMPANY.code]
  );
  const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE code = $1`, [FIRST_COMPANY.code]);
  const companyId = companyRows[0].id;
  console.log(`Company ready: ${FIRST_COMPANY.name} (code: ${FIRST_COMPANY.code})`);

  const passwordHash = await bcrypt.hash(FIRST_ADMIN.password, 12);

  // is_super_admin = true — the first admin can also create further companies
  // from the "Companies" screen, on top of managing their own company as normal.
  await pool.query(
    `INSERT INTO users (company_id, role, is_super_admin, first_name, last_name, email, phone, password_hash, job_role, bank_approved, status)
     VALUES ($1, 'admin', true, $2, $3, $4, $5, $6, $7, true, 'active')
     ON CONFLICT (email) DO NOTHING`,
    [companyId, FIRST_ADMIN.firstName, FIRST_ADMIN.lastName, FIRST_ADMIN.email, FIRST_ADMIN.phone, passwordHash, FIRST_ADMIN.jobRole]
  );

  for (const mgr of MANAGERS) {
    const mgrHash = await bcrypt.hash(mgr.password, 12);
    await pool.query(
      `INSERT INTO users (company_id, role, first_name, last_name, email, phone, password_hash, job_role, bank_approved, status)
       VALUES ($1, 'manager', $2, $3, $4, $5, $6, $7, true, 'active')
       ON CONFLICT (email) DO NOTHING`,
      [companyId, mgr.firstName, mgr.lastName, mgr.email, mgr.phone, mgrHash, mgr.jobRole]
    );
    console.log(`Seeded manager: ${mgr.email} / ${mgr.password}`);
  }

  for (const loc of LOCATIONS) {
    await pool.query(
      `INSERT INTO locations (name, region) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [loc.name, loc.region]
    );
  }

  console.log(`Seed complete. First admin login: company code "${FIRST_COMPANY.code}", ${FIRST_ADMIN.email} / ${FIRST_ADMIN.password}`);
  console.log("Change this password immediately after first login.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
