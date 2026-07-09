require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./db");

// Edit these before running `npm run seed` for your organisation.
const FIRST_ADMIN = {
  firstName: "Priya-Anne",
  lastName: "Osei",
  email: "priya-anne.osei@example.care",
  phone: "07700 900100",
  password: "ChangeMe123!", // the admin should change this on first login
  jobRole: "Rota Coordinator",
};

const LOCATIONS = [
  { name: "Willowbrook House", region: "North" },
  { name: "Oakfield Lodge", region: "North" },
  { name: "Meadow View", region: "South" },
  { name: "Riverside Ward (Domiciliary)", region: "South" },
];

async function seed() {
  const passwordHash = await bcrypt.hash(FIRST_ADMIN.password, 12);

  await pool.query(
    `INSERT INTO users (role, first_name, last_name, email, phone, password_hash, job_role, bank_approved, status)
     VALUES ('admin', $1, $2, $3, $4, $5, $6, true, 'active')
     ON CONFLICT (email) DO NOTHING`,
    [FIRST_ADMIN.firstName, FIRST_ADMIN.lastName, FIRST_ADMIN.email, FIRST_ADMIN.phone, passwordHash, FIRST_ADMIN.jobRole]
  );

  for (const loc of LOCATIONS) {
    await pool.query(
      `INSERT INTO locations (name, region) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [loc.name, loc.region]
    );
  }

  console.log(`Seed complete. First admin login: ${FIRST_ADMIN.email} / ${FIRST_ADMIN.password}`);
  console.log("Change this password immediately after first login.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
