CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  phone VARCHAR(32) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_address JSONB NOT NULL,
  mobility_notes TEXT,
  preferred_hospital_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS care_partner_profiles (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  availability_status VARCHAR(32) NOT NULL DEFAULT 'OFFLINE',
  rating_average NUMERIC NOT NULL DEFAULT 5.0,
  total_journeys_completed INTEGER NOT NULL DEFAULT 0,
  vehicle_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_contacts (
  id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  relationship VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trusted_contact_permissions (
  contact_id VARCHAR(64) PRIMARY KEY REFERENCES family_contacts(id) ON DELETE CASCADE,
  permission_level VARCHAR(32) NOT NULL DEFAULT 'EMERGENCY_ONLY',
  can_view_status BOOLEAN NOT NULL DEFAULT TRUE,
  can_view_location BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_clinical_context BOOLEAN NOT NULL DEFAULT FALSE,
  can_receive_emergency_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  can_communicate_with_partner BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hospitals (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  specialties TEXT[] DEFAULT '{}',
  contact_phone VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR(64) PRIMARY KEY,
  partner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  year INTEGER NOT NULL,
  license_plate VARCHAR(32) NOT NULL,
  accessibility_features TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journeys (
  id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  care_partner_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  current_state VARCHAR(64) NOT NULL,
  pickup_location JSONB NOT NULL,
  hospital_destination JSONB NOT NULL,
  return_dropoff_location JSONB NOT NULL,
  booking_type VARCHAR(32) NOT NULL,
  is_round_trip BOOLEAN NOT NULL DEFAULT TRUE,
  special_assistance_notes TEXT,
  previous_state_before_emergency VARCHAR(64),
  emergency_category VARCHAR(64),
  emergency_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journey_state_history (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  from_state VARCHAR(64) NOT NULL,
  to_state VARCHAR(64) NOT NULL,
  triggered_by_user_id VARCHAR(64),
  note TEXT,
  metadata JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pricing_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  currency VARCHAR(16) NOT NULL DEFAULT 'INR',
  total_estimated_fare NUMERIC NOT NULL,
  base_booking_fee NUMERIC NOT NULL,
  transit_distance_fee NUMERIC NOT NULL,
  companion_service_time_fee NUMERIC NOT NULL,
  platform_service_fee NUMERIC NOT NULL,
  taxes_fee NUMERIC NOT NULL,
  is_estimate BOOLEAN NOT NULL DEFAULT TRUE,
  is_development_pricing BOOLEAN NOT NULL DEFAULT TRUE,
  breakdown_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_incidents (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  category VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  triggered_by_user_id VARCHAR(64) NOT NULL,
  resolved_by_user_id VARCHAR(64),
  resolution_notes TEXT,
  location_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  action VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64),
  details_json JSONB,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);