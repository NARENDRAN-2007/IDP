CREATE TABLE IF NOT EXISTS hospitals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  specialties TEXT[] NOT NULL,
  empanelled BOOLEAN NOT NULL DEFAULT FALSE,
  ownership TEXT,
  address TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hospital_beds (
  hospital_id TEXT REFERENCES hospitals(id) ON DELETE CASCADE,
  bed_type TEXT NOT NULL CHECK (bed_type IN ('ER', 'ICU', 'General')),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT,
  PRIMARY KEY (hospital_id, bed_type)
);

CREATE TABLE IF NOT EXISTS doctors_on_duty (
  id TEXT PRIMARY KEY,
  hospital_id TEXT REFERENCES hospitals(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL CHECK (specialty IN ('general', 'cardiac', 'neuro', 'obstetric')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  shift_start TEXT,
  shift_end TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient', 'driver', 'hospital_staff', 'devops')),
  entity_id TEXT, -- ambulance_id for drivers, hospital_id for hospital_staff
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ambulances (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'free',
  current_request_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  ambulance_id TEXT REFERENCES ambulances(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  fw_version TEXT,
  last_heartbeat TIMESTAMPTZ,
  battery INTEGER,
  rssi INTEGER,
  gps_fix BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'offline'
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  patient_user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  location_source TEXT DEFAULT 'gps',
  status TEXT NOT NULL DEFAULT 'TRIGGERED',
  symptoms_text TEXT,
  severity_level INTEGER,
  required_specialty TEXT CHECK (required_specialty IS NULL OR required_specialty IN ('general', 'cardiac', 'neuro', 'obstetric')),
  bed_type TEXT CHECK (bed_type IS NULL OR bed_type IN ('ER', 'ICU', 'General')),
  assigned_ambulance_id TEXT REFERENCES ambulances(id),
  provisional_hospital_id TEXT REFERENCES hospitals(id),
  confirmed_hospital_id TEXT REFERENCES hospitals(id),
  active_hold_id TEXT,
  cascade_count INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  allocated_doctor_id TEXT,
  allocated_doctor_name TEXT,
  allocated_doctor_specialty TEXT,
  allocated_doctor_room TEXT
);

CREATE TABLE IF NOT EXISTS request_candidates (
  request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
  hospital_id TEXT REFERENCES hospitals(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  PRIMARY KEY (request_id, hospital_id)
);

CREATE TABLE IF NOT EXISTS request_status_log (
  id SERIAL PRIMARY KEY,
  request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  at TIMESTAMPTZ DEFAULT NOW(),
  meta JSONB
);

CREATE TABLE IF NOT EXISTS bed_holds (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES requests(id) ON DELETE CASCADE,
  hospital_id TEXT REFERENCES hospitals(id) ON DELETE CASCADE,
  bed_type TEXT NOT NULL CHECK (bed_type IN ('ER', 'ICU', 'General')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'expired', 'consumed', 'released'))
);

CREATE TABLE IF NOT EXISTS location_pings (
  id SERIAL PRIMARY KEY,
  ambulance_id TEXT REFERENCES ambulances(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  stale BOOLEAN DEFAULT FALSE,
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vitals_readings (
  id SERIAL PRIMARY KEY,
  request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,
  ambulance_id TEXT REFERENCES ambulances(id) ON DELETE SET NULL,
  hr INTEGER,
  spo2 INTEGER,
  valid BOOLEAN DEFAULT TRUE,
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_access_log (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ts TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Plan 6.2 Indexes
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_bed_holds_status_expires ON bed_holds(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_location_pings_amb_ts ON location_pings(ambulance_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_readings_req_ts ON vitals_readings(request_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
