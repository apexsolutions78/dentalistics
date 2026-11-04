CREATE TABLE IF NOT EXISTS clinic_billing_settings (
  organization_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  tax_label VARCHAR(32) NOT NULL DEFAULT 'VAT',
  invoice_prefix VARCHAR(8) NOT NULL DEFAULT 'INV',
  next_number INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_clinic_billing_settings_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  number VARCHAR(32) NULL,
  status ENUM('draft', 'issued', 'partially_paid', 'paid', 'void') NOT NULL DEFAULT 'draft',
  currency CHAR(3) NOT NULL,
  tax_label VARCHAR(32) NOT NULL,
  notes VARCHAR(1000) NULL,
  issued_at DATETIME NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  subtotal_cents INT NOT NULL DEFAULT 0,
  discount_cents INT NOT NULL DEFAULT 0,
  tax_cents INT NOT NULL DEFAULT 0,
  total_cents INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_patient_invoices_org_number (organization_id, number),
  INDEX idx_patient_invoices_org_status (organization_id, status),
  INDEX idx_patient_invoices_org_patient (organization_id, patient_id),
  INDEX idx_patient_invoices_org_issued (organization_id, issued_at),
  CONSTRAINT fk_patient_invoices_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_patient_invoices_patient
    FOREIGN KEY (patient_id) REFERENCES patients (id),
  CONSTRAINT fk_patient_invoices_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS patient_invoice_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  invoice_id BIGINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL,
  description VARCHAR(200) NOT NULL,
  quantity DECIMAL(10, 2) NOT NULL,
  unit_price_cents INT NOT NULL,
  discount_cents INT NOT NULL DEFAULT 0,
  tax_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
  line_subtotal_cents INT NOT NULL,
  line_tax_cents INT NOT NULL,
  line_total_cents INT NOT NULL,
  INDEX idx_patient_invoice_lines_invoice (invoice_id, position),
  CONSTRAINT fk_patient_invoice_lines_invoice
    FOREIGN KEY (invoice_id) REFERENCES patient_invoices (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  patient_id BIGINT UNSIGNED NOT NULL,
  invoice_id BIGINT UNSIGNED NOT NULL,
  amount_cents INT NOT NULL,
  method ENUM('cash', 'card_terminal', 'bank_transfer', 'jazzcash', 'easypaisa', 'other') NOT NULL,
  paid_on DATE NOT NULL,
  note VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_patient_payments_invoice (invoice_id),
  INDEX idx_patient_payments_org_date (organization_id, paid_on),
  INDEX idx_patient_payments_patient (organization_id, patient_id),
  CONSTRAINT fk_patient_payments_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_patient_payments_patient
    FOREIGN KEY (patient_id) REFERENCES patients (id),
  CONSTRAINT fk_patient_payments_invoice
    FOREIGN KEY (invoice_id) REFERENCES patient_invoices (id) ON DELETE CASCADE,
  CONSTRAINT fk_patient_payments_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS clinic_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT UNSIGNED NOT NULL,
  category VARCHAR(80) NOT NULL,
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL,
  expense_date DATE NOT NULL,
  note VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clinic_expenses_org_date (organization_id, expense_date),
  CONSTRAINT fk_clinic_expenses_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id),
  CONSTRAINT fk_clinic_expenses_creator
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);
