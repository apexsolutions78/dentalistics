CREATE TABLE IF NOT EXISTS doctors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  specialty VARCHAR(120) NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(254) NULL,
  work_hours TEXT NOT NULL,
  slot_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_doctors_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_doctors_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_doctors_org_active (organization_id, is_active)
);

ALTER TABLE appointments
  ADD COLUMN doctor_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_appointments_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE SET NULL,
  ADD INDEX idx_appointments_doctor_date (doctor_id, appointment_date);

ALTER TABLE leads
  ADD COLUMN urgency_level ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'LOW',
  ADD COLUMN urgency_score INT NOT NULL DEFAULT 0,
  ADD COLUMN urgency_reasons TEXT NULL,
  ADD COLUMN urgency_computed_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS lead_slot_suggestions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  lead_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  urgency_level ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'RESCHEDULED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  appointment_id BIGINT UNSIGNED NULL,
  decided_by BIGINT UNSIGNED NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_suggestions_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_suggestions_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
  CONSTRAINT fk_suggestions_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,
  CONSTRAINT fk_suggestions_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
  CONSTRAINT fk_suggestions_decider FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_suggestions_lead_status (lead_id, status),
  INDEX idx_suggestions_org_status (organization_id, status),
  INDEX idx_suggestions_doctor_slot (doctor_id, slot_date, slot_time)
);
