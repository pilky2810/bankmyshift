-- Bank My Shift — database schema
-- Run via: npm run migrate  (see src/migrate.js)

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- for case-insensitive email matching

CREATE TYPE user_role AS ENUM ('staff', 'manager', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE shift_status AS ENUM ('open', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'handback_requested');
CREATE TYPE claim_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE notif_channel AS ENUM ('in_app', 'email', 'sms', 'push');

-- Each customer organisation using the app (e.g. Frank House Care Services).
-- `code` is what everyone types at login (e.g. "fhcs") — lowercase, short, memorable.
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code CITEXT UNIQUE NOT NULL,
  -- How this company's "hours & pay" totals are grouped — different companies
  -- run different payroll cycles, so each sets its own. Enforced app-side too
  -- (see routes/companies.js), the CHECK here is just a backstop.
  pay_period_type TEXT NOT NULL DEFAULT 'weekly' CHECK (pay_period_type IN ('weekly', 'biweekly', 'four_weekly', 'monthly')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  region TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  role user_role NOT NULL DEFAULT 'staff',
  -- Platform-level admin (not tied to any one company's data) who can create and
  -- manage companies from the "Companies" screen. Nearly everyone is false here —
  -- normal admins/managers/staff are scoped entirely to their own company_id.
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email CITEXT UNIQUE NOT NULL, -- unique across the whole system, not just per company
  phone TEXT,
  password_hash TEXT NOT NULL,
  job_role TEXT,
  pay_band TEXT,
  bank_approved BOOLEAN NOT NULL DEFAULT false,
  status user_status NOT NULL DEFAULT 'active',
  gender TEXT, -- nullable/free text; used only for shift gender requirements, not required
  has_driving_licence BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_company ON users(company_id);

-- Password reset codes (short-lived, single use)
CREATE TABLE password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  training_type TEXT NOT NULL,
  issued_date DATE,
  expiry_date DATE,
  document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT, -- 0=Sun .. 6=Sat, nullable if using specific date range instead
  date_from DATE,
  date_to DATE,
  available_from TIME,
  available_to TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  location_id UUID REFERENCES locations(id),
  location_name TEXT NOT NULL, -- denormalised for fast filtering
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  service_type TEXT NOT NULL,
  client_ref TEXT, -- kept deliberately generic/pseudonymised — see compliance guide
  pay_rate NUMERIC(6,2) NOT NULL,
  required_skills TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  mileage_note TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  driver_required BOOLEAN NOT NULL DEFAULT false,
  required_gender TEXT, -- nullable; 'male' or 'female' when a manager sets one, see compliance guide
  status shift_status NOT NULL DEFAULT 'open',
  previous_status shift_status, -- set when cancelled or a hand-back is requested, so it can be restored
  claimed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_date ON shifts(date);
CREATE INDEX idx_shifts_status ON shifts(status);
CREATE INDEX idx_shifts_location ON shifts(location_name);
CREATE INDEX idx_shifts_claimed_by ON shifts(claimed_by);
CREATE INDEX idx_shifts_company ON shifts(company_id);

CREATE TABLE shift_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  status claim_status NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ
);

CREATE INDEX idx_claims_shift ON shift_claims(shift_id);
CREATE INDEX idx_claims_user ON shift_claims(user_id);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- new_shift | approved | rejected | cancelled | reminder | info
  channel notif_channel NOT NULL DEFAULT 'in_app',
  message TEXT NOT NULL,
  related_shift_id UUID REFERENCES shifts(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user ON notifications(user_id);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,        -- e.g. 'shift.created', 'claim.approved'
  entity_type TEXT NOT NULL,   -- e.g. 'shift', 'user'
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
