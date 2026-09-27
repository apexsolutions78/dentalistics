ALTER TABLE organizations
  ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  status ENUM('SCHEDULED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED')
    NOT NULL DEFAULT 'SCHEDULED',
  service VARCHAR(120) NULL,
  provider VARCHAR(120) NULL,
  previous_appointment_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointments_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients (id),
  CONSTRAINT fk_appointments_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE SET NULL,
  CONSTRAINT fk_appointments_previous FOREIGN KEY (previous_appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
  CONSTRAINT fk_appointments_creator FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_appointments_org_date (organization_id, appointment_date, appointment_time),
  INDEX idx_appointments_org_status (organization_id, status),
  INDEX idx_appointments_patient (patient_id),
  INDEX idx_appointments_lead (lead_id)
);
