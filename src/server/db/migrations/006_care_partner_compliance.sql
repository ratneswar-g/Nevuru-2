ALTER TABLE care_partner_profiles ADD COLUMN IF NOT EXISTS compliance_documents JSONB DEFAULT '[]';
