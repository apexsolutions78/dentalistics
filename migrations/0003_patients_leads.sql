CREATE TABLE IF NOT EXISTS patients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254) NULL,
  notes TEXT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_patients_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_patients_creator FOREIGN KEY (created_by) REFERENCES users (id),
  UNIQUE KEY uq_patients_org_phone (organization_id, phone),
  INDEX idx_patients_org_name (organization_id, last_name)
);

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  email VARCHAR(254) NULL,
  requested_service VARCHAR(120) NULL,
  source ENUM('WEBSITE', 'MISSED_CALL', 'MANUAL', 'OTHER') NOT NULL,
  status ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED', 'LOST', 'CLOSED') NOT NULL DEFAULT 'NEW',
  assigned_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leads_organization FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_leads_assigned FOREIGN KEY (assigned_user_id) REFERENCES users (id),
  CONSTRAINT fk_leads_creator FOREIGN KEY (created_by) REFERENCES users (id),
  INDEX idx_leads_org_status (organization_id, status),
  INDEX idx_leads_org_created (organization_id, created_at),
  INDEX idx_leads_org_phone (organization_id, phone)
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  detail VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lead_activities_lead FOREIGN KEY (lead_id) REFERENCES leads (id) ON DELETE CASCADE,
  CONSTRAINT fk_lead_activities_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
  INDEX idx_lead_activities_lead (lead_id, created_at)
);
