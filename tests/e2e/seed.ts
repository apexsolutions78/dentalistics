import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../../src/auth/password';
import { dateOnly, dateTimeAt } from './dates';

export interface E2EIds {
  orgId: number;
  ownerId: number;
  deskId: number;
  patient1Id: number;
  patient2Id: number;
  patient3Id: number;
  patient4Id: number;
  patient5Id: number;
  lead1Id: number;
  lead2Id: number;
  appt3Id: number;
  appt4Id: number;
  recall5Id: number;
}

export const E2E_ORG_NAME = 'E2E Dental Clinic';
export const E2E_OWNER_EMAIL = 'e2e-owner@e2e.test';
export const E2E_OWNER_PASSWORD = 'OwnerPass123!';
export const E2E_DESK_EMAIL = 'e2e-desk@e2e.test';
export const E2E_DESK_PASSWORD = 'DeskPass123!';

export const P1_PHONE = '+15550710001';
export const P2_PHONE = '+15550710002';
export const P3_PHONE = '+15550710003';
export const P4_PHONE = '+15550710004';
export const P5_PHONE = '+15550710005';

async function cleanup(pool: Pool, orgId: number): Promise<void> {
  const stmts: string[] = [
    'DELETE FROM communication_messages WHERE organization_id = ?',
    'DELETE FROM call_events WHERE organization_id = ?',
    'DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ?)',
    'DELETE FROM appointment_reminders WHERE organization_id = ?',
    'DELETE FROM review_requests WHERE organization_id = ?',
    'DELETE FROM recall_messages WHERE organization_id = ?',
    'DELETE FROM no_show_messages WHERE organization_id = ?',
    'DELETE FROM recalls WHERE organization_id = ?',
    'DELETE FROM no_show_cases WHERE organization_id = ?',
    'DELETE FROM appointments WHERE organization_id = ?',
    'DELETE FROM leads WHERE organization_id = ?',
    'DELETE FROM patients WHERE organization_id = ?',
    'DELETE FROM audit_logs WHERE organization_id = ?',
    'DELETE FROM webhook_events WHERE organization_id = ?',
    'DELETE FROM error_events WHERE organization_id = ?',
    'DELETE FROM organization_settings WHERE organization_id = ?',
    'DELETE FROM users WHERE organization_id = ?',
    'DELETE FROM organizations WHERE id = ?',
  ];
  for (const sql of stmts) {
    await pool.query(sql, [orgId]);
  }
}

export async function seedE2E(pool: Pool): Promise<E2EIds> {
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM organizations WHERE name = ? ORDER BY id ASC LIMIT 1',
    [E2E_ORG_NAME],
  );
  if (existing[0] !== undefined) {
    await cleanup(pool, Number(existing[0].id));
  }

  const [orgResult] = await pool.query(
    `INSERT INTO organizations (name, status, onboarding_completed_at, site_key)
     VALUES (?, 'active', UTC_TIMESTAMP(), SHA2(CONCAT(UUID(), UUID()), 256))`,
    [E2E_ORG_NAME],
  );
  const orgId = Number((orgResult as ResultSetHeader).insertId);

  const ownerHash = await hashPassword(E2E_OWNER_PASSWORD);
  const deskHash = await hashPassword(E2E_DESK_PASSWORD);
  const [ownerResult] = await pool.query(
    'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, \'owner\')',
    [orgId, E2E_OWNER_EMAIL, ownerHash],
  );
  const ownerId = Number((ownerResult as ResultSetHeader).insertId);
  const [deskResult] = await pool.query(
    'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, \'receptionist\')',
    [orgId, E2E_DESK_EMAIL, deskHash],
  );
  const deskId = Number((deskResult as ResultSetHeader).insertId);

  async function insertPatient(first: string, last: string, phone: string): Promise<number> {
    const [result] = await pool.query(
      'INSERT INTO patients (organization_id, first_name, last_name, phone, created_by) VALUES (?, ?, ?, ?, ?)',
      [orgId, first, last, phone, ownerId],
    );
    return Number((result as ResultSetHeader).insertId);
  }

  const patient1Id = await insertPatient('Luna', 'Leadson', P1_PHONE);
  const patient2Id = await insertPatient('Milo', 'Caller', P2_PHONE);
  const patient3Id = await insertPatient('Cara', 'Confirm', P3_PHONE);
  const patient4Id = await insertPatient('Nina', 'Noshow', P4_PHONE);
  const patient5Id = await insertPatient('Rosa', 'Recall', P5_PHONE);

  const [lead1Result] = await pool.query(
    `INSERT INTO leads
       (organization_id, first_name, last_name, phone, requested_service, source, status,
        last_activity_at, created_by, created_at)
     VALUES (?, 'Luna', 'Leadson', ?, 'Whitening', 'MANUAL', 'NEW', ?, ?, ?)`,
    [orgId, P1_PHONE, dateTimeAt(-1, '10:15'), ownerId, dateTimeAt(-1, '10:15')],
  );
  const lead1Id = Number((lead1Result as ResultSetHeader).insertId);

  const [lead2Result] = await pool.query(
    `INSERT INTO leads
       (organization_id, first_name, last_name, phone, source, status,
        last_activity_at, created_by, created_at)
     VALUES (?, 'Milo', 'Caller', ?, 'MISSED_CALL', 'NEW', ?, ?, ?)`,
    [orgId, P2_PHONE, dateTimeAt(-1, '09:14'), ownerId, dateTimeAt(-1, '09:14')],
  );
  const lead2Id = Number((lead2Result as ResultSetHeader).insertId);

  await pool.query(
    `INSERT INTO lead_activities (lead_id, actor_user_id, action, detail, created_at)
     VALUES (?, ?, 'created', 'Lead captured manually', ?)`,
    [lead1Id, ownerId, dateTimeAt(-1, '10:15')],
  );
  await pool.query(
    `INSERT INTO lead_activities (lead_id, actor_user_id, action, detail, created_at)
     VALUES (?, NULL, 'acknowledged', 'Automatic acknowledgement sent', ?)`,
    [lead1Id, dateTimeAt(-1, '10:16')],
  );
  await pool.query(
    `INSERT INTO lead_activities (lead_id, actor_user_id, action, detail, created_at)
     VALUES (?, ?, 'created', 'Lead created from missed call', ?)`,
    [lead2Id, ownerId, dateTimeAt(-1, '09:14')],
  );

  interface MessageSeed {
    leadId: number | null;
    recipient: string;
    body: string;
    direction: 'OUTBOUND' | 'INBOUND';
    status: string;
    template: string | null;
    idempotency: string;
    createdAt: string;
  }

  const messages: MessageSeed[] = [
    {
      leadId: lead1Id,
      recipient: P1_PHONE,
      body: 'Thanks for reaching out to Apex Dental!',
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      template: 'lead_acknowledgement',
      idempotency: 'e2e-l1-ack',
      createdAt: dateTimeAt(-1, '10:16'),
    },
    {
      leadId: lead1Id,
      recipient: P1_PHONE,
      body: 'Great — I will book now.',
      direction: 'INBOUND',
      status: 'RECEIVED',
      template: null,
      idempotency: 'e2e-l1-reply',
      createdAt: dateTimeAt(-1, '10:20'),
    },
    {
      leadId: lead2Id,
      recipient: P2_PHONE,
      body: 'We missed your call — how can we help?',
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      template: 'missed_call_response',
      idempotency: 'e2e-l2-auto',
      createdAt: dateTimeAt(-1, '09:15'),
    },
    {
      leadId: lead2Id,
      recipient: P2_PHONE,
      body: 'Thanks, please book me in.',
      direction: 'INBOUND',
      status: 'RECEIVED',
      template: null,
      idempotency: 'e2e-l2-reply',
      createdAt: dateTimeAt(-1, '09:20'),
    },
    {
      leadId: null,
      recipient: P5_PHONE,
      body: 'Time for your cleaning — book now.',
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      template: 'recall_initial',
      idempotency: 'e2e-p5-recall-1',
      createdAt: dateTimeAt(-1, '11:00'),
    },
    {
      leadId: null,
      recipient: P5_PHONE,
      body: 'Yes, next week works.',
      direction: 'INBOUND',
      status: 'RECEIVED',
      template: null,
      idempotency: 'e2e-p5-reply',
      createdAt: dateTimeAt(-1, '11:05'),
    },
  ];
  for (const m of messages) {
    await pool.query(
      `INSERT INTO communication_messages
         (organization_id, channel, recipient, body, status, idempotency_key,
          direction, template, lead_id, created_at, updated_at)
       VALUES (?, 'SMS', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orgId,
        m.recipient,
        m.body,
        m.status,
        m.idempotency,
        m.direction,
        m.template,
        m.leadId,
        m.createdAt,
        m.createdAt,
      ],
    );
  }

  await pool.query(
    `INSERT INTO call_events
       (organization_id, provider_key, provider_event_id, provider_status, call_outcome,
        caller_number, called_number, occurred_at, status, disposition, lead_id, patient_id,
        raw_payload, created_at, updated_at)
     VALUES (?, 'e2e', 'e2e-call-1', 'completed', 'MISSED', ?, '+15550001234', ?,
             'RECORDED', 'no_action', ?, ?, '{}', ?, ?)`,
    [orgId, P2_PHONE, dateTimeAt(-1, '09:14'), lead2Id, patient2Id, dateTimeAt(-1, '09:14'), dateTimeAt(-1, '09:14')],
  );

  const [appt3Result] = await pool.query(
    `INSERT INTO appointments
       (organization_id, patient_id, appointment_date, appointment_time, status, service, provider, created_by)
     VALUES (?, ?, ?, ?, 'SCHEDULED', 'Check-up', 'Dr. Apex', ?)`,
    [orgId, patient3Id, dateOnly(0), '10:00', ownerId],
  );
  const appt3Id = Number((appt3Result as ResultSetHeader).insertId);

  await pool.query(
    `INSERT INTO appointment_reminders (organization_id, appointment_id, offset_hours, scheduled_at, status)
     VALUES (?, ?, 24, ?, 'PENDING')`,
    [orgId, appt3Id, dateTimeAt(1, '10:00')],
  );

  const [appt4Result] = await pool.query(
    `INSERT INTO appointments
       (organization_id, patient_id, appointment_date, appointment_time, status, service, provider, created_by)
     VALUES (?, ?, ?, ?, 'SCHEDULED', 'Filling', 'Dr. Apex', ?)`,
    [orgId, patient4Id, dateOnly(-1), '11:00', ownerId],
  );
  const appt4Id = Number((appt4Result as ResultSetHeader).insertId);

  const [recallResult] = await pool.query(
    `INSERT INTO recalls
       (organization_id, patient_id, recall_type, due_date, status, opened_at)
     VALUES (?, ?, 'hygiene', ?, 'DUE', ?)`,
    [orgId, patient5Id, dateOnly(-40), dateTimeAt(-45, '09:00')],
  );
  const recall5Id = Number((recallResult as ResultSetHeader).insertId);

  return {
    orgId,
    ownerId,
    deskId,
    patient1Id,
    patient2Id,
    patient3Id,
    patient4Id,
    patient5Id,
    lead1Id,
    lead2Id,
    appt3Id,
    appt4Id,
    recall5Id,
  };
}
