ALTER TABLE patients
  ADD COLUMN sms_opt_out TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS appointment_reminders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  offset_hours INT NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING',
  message_id BIGINT UNSIGNED NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  suppression_reason VARCHAR(64) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_reminders_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_reminders_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_reminders_message FOREIGN KEY (message_id) REFERENCES communication_messages (id) ON DELETE SET NULL,
  UNIQUE KEY uq_reminders_appt_offset (appointment_id, offset_hours),
  INDEX idx_reminders_due (status, scheduled_at),
  INDEX idx_reminders_org (organization_id, status)
);
