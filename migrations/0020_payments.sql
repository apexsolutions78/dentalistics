CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  plan ENUM('trial', 'full') NOT NULL DEFAULT 'full',
  amount_usd_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  status ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  provider VARCHAR(32) NOT NULL DEFAULT 'mock',
  order_id VARCHAR(64) NOT NULL,
  provider_transaction_id VARCHAR(128) NULL,
  checkout_url VARCHAR(1024) NULL,
  last_error VARCHAR(512) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payments_order_id (order_id),
  INDEX idx_payments_org_status (organization_id, status),
  CONSTRAINT fk_payments_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);
