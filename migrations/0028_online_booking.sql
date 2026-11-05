-- Public online booking.
-- Lead rows created by the booking page use source ONLINE_BOOKING.
-- booking_slot_holds is the unique guard for two patients taking the
-- same doctor start time. A cancelled appointment releases its hold
-- the next time that start time is booked.

ALTER TABLE leads
  MODIFY COLUMN source ENUM('WEBSITE', 'MISSED_CALL', 'MANUAL', 'OTHER', 'ONLINE_BOOKING') NOT NULL;

CREATE TABLE IF NOT EXISTS booking_slot_holds (
  organization_id BIGINT UNSIGNED NOT NULL,
  doctor_id BIGINT UNSIGNED NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  appointment_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (doctor_id, slot_date, slot_time),
  UNIQUE KEY uq_booking_slot_appointment (appointment_id),
  CONSTRAINT fk_booking_holds_organization
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_holds_doctor
    FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_holds_appointment
    FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
);
