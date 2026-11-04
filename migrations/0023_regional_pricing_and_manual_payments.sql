-- Regional prices, manual payment review, patient import, and setup-help requests.
--
-- Trial length for new signups is TRIAL_DAYS in src/plans.ts (14).
-- This migration does not read or write organizations.trial_ends_at.
-- Clinics that already have a trial end date keep that date.
--
-- USD 2000 minor units ($20.00) is the existing Full Plan price and is
-- not a placeholder. Every other amount is a coarse stand-in for the
-- owner to replace in Platform → Pricing. Those figures are not quoted
-- exchange rates. is_placeholder = 1 is that mark. Minor units use
-- 2 decimal places (ISO 4217 exponent 2) for USD, AED, CAD, GBP, EUR,
-- AUD, NZD, and PKR. The admin screen edits the major amount.
--
-- Payment-method rows name the channels the owner uses. The instruction
-- text is empty and the rows are disabled. Bank details are never seeded.

CREATE TABLE IF NOT EXISTS regional_prices (
  region_code VARCHAR(8) NOT NULL PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor INT NOT NULL,
  is_placeholder TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO regional_prices (region_code, label, currency, amount_minor, is_placeholder, sort_order)
VALUES
  ('us', 'United States', 'USD', 2000, 0, 10),
  ('ae', 'United Arab Emirates', 'AED', 8000, 1, 20),
  ('ca', 'Canada', 'CAD', 3000, 1, 30),
  ('gb', 'United Kingdom', 'GBP', 2000, 1, 40),
  ('ie', 'Ireland', 'EUR', 2000, 1, 50),
  ('au', 'Australia', 'AUD', 3000, 1, 60),
  ('nz', 'New Zealand', 'NZD', 4000, 1, 70),
  ('pk', 'Pakistan', 'PKR', 600000, 1, 80);

CREATE TABLE IF NOT EXISTS manual_payment_methods (
  method_key VARCHAR(32) NOT NULL PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  instructions TEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  region_codes VARCHAR(128) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO manual_payment_methods (method_key, label, instructions, enabled, region_codes, sort_order)
VALUES
  ('payoneer_ach', 'Payoneer — US bank transfer (ACH)', '', 0, 'us,ae,ca,gb,ie,au,nz', 10),
  ('payoneer_wire', 'Payoneer — US bank wire', '', 0, 'us,ae,ca,gb,ie,au,nz', 20),
  ('jazzcash', 'JazzCash', '', 0, 'pk', 30),
  ('easypaisa', 'EasyPaisa', '', 0, 'pk', 40),
  ('meezan', 'Meezan Bank transfer', '', 0, 'pk', 50);

CREATE TABLE IF NOT EXISTS setup_help_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_setup_help_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_setup_help_user FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_setup_help_status (status, id)
);

ALTER TABLE patients
  ADD COLUMN date_of_birth DATE NULL AFTER email;

ALTER TABLE payments
  MODIFY COLUMN status ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN amount_minor INT NULL AFTER amount_usd_cents,
  ADD COLUMN region_code VARCHAR(8) NULL AFTER currency,
  ADD COLUMN method_key VARCHAR(32) NULL AFTER provider,
  ADD COLUMN payer_reference VARCHAR(128) NULL AFTER checkout_url,
  ADD COLUMN receipt_stored_name VARCHAR(64) NULL AFTER payer_reference,
  ADD COLUMN receipt_content_type VARCHAR(64) NULL AFTER receipt_stored_name,
  ADD COLUMN rejection_reason VARCHAR(512) NULL AFTER last_error,
  ADD INDEX idx_payments_manual_status (provider, status);
