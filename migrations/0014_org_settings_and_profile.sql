ALTER TABLE organizations
  ADD COLUMN phone VARCHAR(32) NULL,
  ADD COLUMN email VARCHAR(254) NULL,
  ADD COLUMN address VARCHAR(255) NULL,
  ADD COLUMN logo_url VARCHAR(512) NULL,
  ADD COLUMN business_hours TEXT NULL;

CREATE TABLE IF NOT EXISTS organization_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  meta_key VARCHAR(100) NOT NULL,
  meta_value TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_organization_settings_org_key (organization_id, meta_key),
  CONSTRAINT fk_organization_settings_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);
