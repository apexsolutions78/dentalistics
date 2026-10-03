ALTER TABLE organizations
  ADD COLUMN onboarding_completed_at DATETIME NULL;

UPDATE organizations
SET onboarding_completed_at = UTC_TIMESTAMP();
