ALTER TABLE leads
  ADD INDEX idx_leads_created (created_at);

ALTER TABLE appointments
  ADD INDEX idx_appointments_created (created_at);

ALTER TABLE communication_messages
  ADD INDEX idx_comm_messages_outbound_sent (direction, sent_at);
