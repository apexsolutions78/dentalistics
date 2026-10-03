ALTER TABLE organizations
  ADD COLUMN plan ENUM('trial', 'full') NOT NULL DEFAULT 'full',
  ADD COLUMN trial_ends_at DATETIME NULL;
