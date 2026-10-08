CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  journey_id VARCHAR(64) NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  patient_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'INR',
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  idempotency_key VARCHAR(128),
  provider VARCHAR(32) NOT NULL DEFAULT 'MOCK_SANDBOX',
  provider_order_id VARCHAR(128) NOT NULL,
  provider_payment_id VARCHAR(128),
  provider_signature TEXT,
  failure_reason TEXT,
  receipt_number VARCHAR(64) NOT NULL,
  fare_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_journey_id ON payments(journey_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient_id ON payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_order_id ON payments(provider_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;
