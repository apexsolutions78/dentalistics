CREATE TABLE IF NOT EXISTS patient_teeth (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  tooth_fdi CHAR(2) NOT NULL,
  conditions JSON NOT NULL,
  notes TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patient_teeth_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_patient_teeth_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_patient_teeth_author FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
  UNIQUE KEY uq_patient_teeth (organization_id, patient_id, tooth_fdi),
  INDEX idx_patient_teeth_patient (patient_id)
);

CREATE TABLE IF NOT EXISTS patient_tooth_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  tooth_fdi CHAR(2) NOT NULL,
  conditions JSON NOT NULL,
  notes TEXT NULL,
  author_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tooth_history_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_tooth_history_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_tooth_history_author FOREIGN KEY (author_user_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_tooth_history_patient (organization_id, patient_id, created_at)
);

CREATE TABLE IF NOT EXISTS treatment_plan_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  tooth_fdi CHAR(2) NOT NULL,
  procedure_name VARCHAR(160) NOT NULL,
  status ENUM('PLANNED', 'DONE') NOT NULL DEFAULT 'PLANNED',
  estimated_fee DECIMAL(10, 2) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_treatment_plan_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_treatment_plan_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_treatment_plan_author FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_treatment_plan_patient (organization_id, patient_id, status)
);
