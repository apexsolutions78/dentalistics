CREATE TABLE IF NOT EXISTS no_show_cases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  status ENUM('OPEN', 'REBOOKED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  rebooked_appointment_id BIGINT UNSIGNED NULL,
  close_reason VARCHAR(64) NULL,
  opened_at DATETIME NOT NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_noshow_cases_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_noshow_cases_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE,
  CONSTRAINT fk_noshow_cases_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_noshow_cases_rebooked FOREIGN KEY (rebooked_appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
  UNIQUE KEY uq_noshow_cases_appointment (appointment_id),
  INDEX idx_noshow_cases_org_status (organization_id, status)
);

CREATE TABLE IF NOT EXISTS no_show_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  organization_id BIGINT UNSIGNED NOT NULL,
  phase ENUM('INITIAL', 'FOLLOW_UP') NOT NULL,
  status ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING',
  scheduled_at DATETIME NOT NULL,
  sent_at DATETIME NULL,
  message_id BIGINT UNSIGNED NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  suppression_reason VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_noshow_messages_case FOREIGN KEY (case_id) REFERENCES no_show_cases (id) ON DELETE CASCADE,
  CONSTRAINT fk_noshow_messages_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_noshow_messages_message FOREIGN KEY (message_id) REFERENCES communication_messages (id) ON DELETE SET NULL,
  UNIQUE KEY uq_noshow_messages_case_phase (case_id, phase),
  INDEX idx_noshow_messages_due (status, scheduled_at)
);
