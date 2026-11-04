-- Recurring monthly billing.
--
-- paid_until is the UTC instant the current paid period ends. Writes and
-- patient automations continue through a grace window after that instant
-- (BILLING_GRACE_DAYS, default 3). Once the grace window has elapsed the
-- clinic is read-only: existing rows stay, and no patient automation is sent.
-- subscription_lapsed_at is set by the billing scheduler the first time that
-- happens and cleared when a later payment extends the period. NULL paid_until
-- on plan 'full' means the clinic is not on the subscription clock.
--
-- Backfill choice: every clinic already on plan 'full' receives one billing
-- period measured from the moment this migration runs
-- (paid_until = UTC_TIMESTAMP() + 1 month). The previous model treated the
-- first successful payment, and platform-admin activation, as permanent.
-- Expiring those clinics at deploy time would lock live clinics immediately.
-- One month from the migration starts the recurring clock without an outage.
-- Trial clinics are unchanged (paid_until stays NULL). The UPDATE is guarded
-- with paid_until IS NULL, so a manual re-run does not grant a second month.
-- The migration runner also applies this file only once.

ALTER TABLE organizations
  ADD COLUMN paid_until DATETIME NULL,
  ADD COLUMN subscription_lapsed_at DATETIME NULL,
  ADD INDEX idx_organizations_paid_until (paid_until);

UPDATE organizations
SET paid_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 MONTH)
WHERE plan = 'full' AND paid_until IS NULL;
