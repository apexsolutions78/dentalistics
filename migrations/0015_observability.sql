CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NULL,
  source ENUM('telephony', 'whatsapp') NOT NULL,
  request_method VARCHAR(8) NOT NULL,
  http_status SMALLINT NOT NULL,
  outcome VARCHAR(64) NOT NULL,
  provider_key VARCHAR(64) NULL,
  remote_ip VARCHAR(45) NULL,
  detail VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_webhook_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  INDEX idx_webhook_events_org_created (organization_id, created_at),
  INDEX idx_webhook_events_source_created (source, created_at)
);

CREATE TABLE IF NOT EXISTS error_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NULL,
  scope VARCHAR(32) NOT NULL DEFAULT 'request',
  request_method VARCHAR(8) NULL,
  request_path VARCHAR(500) NULL,
  http_status SMALLINT NOT NULL,
  error_code VARCHAR(64) NOT NULL,
  error_name VARCHAR(100) NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_error_events_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  INDEX idx_error_events_org_created (organization_id, created_at),
  INDEX idx_error_events_status_created (http_status, created_at)
);
