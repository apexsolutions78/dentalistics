ALTER TABLE organizations
  ADD COLUMN review_url VARCHAR(512) NULL;

CREATE TABLE IF NOT EXISTS review_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING',
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  message_id BIGINT UNSIGNED NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  suppression_reason VARCHAR(64) NULL,
  review_url VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_review_requests_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_review_requests_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_review_requests_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_review_requests_message FOREIGN KEY (message_id) REFERENCES communication_messages (id) ON DELETE SET NULL,
  UNIQUE KEY uq_review_requests_appointment (appointment_id),
  INDEX idx_review_requests_org_status (organization_id, status),
  INDEX idx_review_requests_due (status, scheduled_at),
  INDEX idx_review_requests_patient (patient_id, created_at)
);
