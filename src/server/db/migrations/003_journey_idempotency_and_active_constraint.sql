CREATE TABLE IF NOT EXISTS journey_idempotency_keys (
  id VARCHAR(64) PRIMARY KEY,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_patient_idempotency UNIQUE (patient_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_journey_idempotency_lookup ON journey_idempotency_keys (patient_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_journey_idempotency_journey_id ON journey_idempotency_keys (journey_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_unique_active_patient ON journeys (patient_id)
WHERE current_state NOT IN ('COMPLETED', 'CANCELLED', 'PARTNER_CANCELLED');