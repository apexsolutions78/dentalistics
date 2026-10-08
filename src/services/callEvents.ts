import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { sendMissedCallResponse } from '../automation/missedCall';
import { runLeadAutomation } from '../automation/leadAutomation';
import type { Logger } from '../logger';
import type { InboundCallEvent } from '../telephony/types';
import { RECOVERY_OUTCOMES } from '../telephony/types';
import { ACTIVE_STATUSES, recordLeadActivity } from './leads';
import { normalizePhone } from '../validate';

export interface IngestCallInput {
  organizationId: number;
  providerKey: string;
  event: InboundCallEvent;
  rawPayload: string;
}

export interface IngestCallResult {
  duplicate: boolean;
  callEventId: number;
  status: string;
  disposition: string;
  leadId: number | null;
  patientId: number | null;
  messageId: number | null;
}

interface PatientRow extends RowDataPacket {
  id: number;
  first_name: string;
  sms_opt_out: number | boolean;
}

interface LeadRow extends RowDataPacket {
  id: number;
  first_name: string;
}

interface OrgRow extends RowDataPacket {
  id: number;
  name: string;
  phone: string | null;
}

interface EventRow extends RowDataPacket {
  id: number;
  status: string;
  disposition: string;
  lead_id: number | null;
  patient_id: number | null;
  message_id: number | null;
}

async function findPatientByPhone(db: Pool, organizationId: number, phone: string): Promise<PatientRow | null> {
  const [rows] = await db.query<PatientRow[]>(
    'SELECT id, first_name, sms_opt_out FROM patients WHERE organization_id = ? AND phone = ? ORDER BY id ASC LIMIT 1',
    [organizationId, phone],
  );
  return rows[0] ?? null;
}

async function findActiveLeadByPhone(db: Pool, organizationId: number, phone: string): Promise<LeadRow | null> {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
  const [rows] = await db.query<LeadRow[]>(
    `SELECT id, first_name FROM leads
     WHERE organization_id = ? AND phone = ? AND status IN (${placeholders})
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [organizationId, phone, ...ACTIVE_STATUSES],
  );
  return rows[0] ?? null;
}

async function createMissedCallLead(
  db: Pool,
  logger: Logger,
  organizationId: number,
  phone: string,
  event: InboundCallEvent,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO leads (organization_id, first_name, last_name, phone, source, status, notes)
     VALUES (?, 'Unknown', ?, ?, 'MISSED_CALL', 'NEW', ?)`,
    [
      organizationId,
      phone,
      phone,
      `Missed call from ${phone} (${event.outcome}) at ${event.occurredAt.toISOString()}`,
    ],
  );
  const leadId = result.insertId;
  await recordLeadActivity(
    db,
    logger,
    leadId,
    null,
    'created',
    `source=MISSED_CALL status=NEW event=${event.eventId}`,
  );
  logger.info('missed-call lead created', { organizationId, leadId, phone });
  return leadId;
}

async function recover(
  db: Pool,
  logger: Logger,
  organizationId: number,
  providerKey: string,
  event: InboundCallEvent,
  callEventId: number,
  phone: string,
): Promise<Pick<IngestCallResult, 'status' | 'disposition' | 'leadId' | 'patientId' | 'messageId'>> {
  const [patient, lead] = await Promise.all([
    findPatientByPhone(db, organizationId, phone),
    findActiveLeadByPhone(db, organizationId, phone),
  ]);

  let leadId: number | null = null;
  const patientId: number | null = patient?.id ?? null;
  let disposition: string;
  let firstName: string;

  if (lead !== null) {
    leadId = lead.id;
    firstName = lead.first_name;
    disposition = 'lead_updated';
    await recordLeadActivity(
      db,
      logger,
      leadId,
      null,
      'call_missed',
      `outcome=${event.outcome} provider=${providerKey} event=${event.eventId}`,
    );
  } else if (patient !== null) {
    firstName = patient.first_name;
    disposition = 'patient_contacted';
  } else {
    leadId = await createMissedCallLead(db, logger, organizationId, phone, event);
    firstName = 'Unknown';
    disposition = 'lead_created';
    await runLeadAutomation(db, logger, { organizationId, leadId, mode: 'create' });
  }

  let status = 'PROCESSED';
  let messageId: number | null = null;
  let lastError: string | null = null;

  const [orgRows] = await db.query<OrgRow[]>('SELECT id, name, phone FROM organizations WHERE id = ?', [
    organizationId,
  ]);
  const org = orgRows[0];

  const suppressedByConsent = patient !== null && (patient.sms_opt_out === true || patient.sms_opt_out === 1);
  if (suppressedByConsent) {
    disposition = 'consent_suppressed';
  } else if (org === undefined) {
    status = 'PARTIAL';
    lastError = 'organization_not_found';
  } else {
    const response = await sendMissedCallResponse(db, logger, {
      organizationId,
      providerKey,
      eventId: event.eventId,
      to: phone,
      firstName,
      clinicName: org.name,
      clinicPhone: org.phone,
      leadId,
    });
    if (response.messageId !== undefined) {
      messageId = response.messageId;
    }
    if (response.action === 'sent' || response.action === 'duplicate') {
      status = 'PROCESSED';
    } else if (response.action === 'skipped_disabled') {
      disposition = 'automation_disabled';
    } else {
      status = 'PARTIAL';
      lastError = `missed-call response ${response.action}`;
    }
  }

  await db.query(
    `UPDATE call_events
     SET status = ?, disposition = ?, lead_id = ?, patient_id = ?, message_id = ?, last_error = ?
     WHERE id = ?`,
    [status, disposition, leadId, patientId, messageId, lastError, callEventId],
  );
  logger.info('call event processed', {
    callEventId,
    outcome: event.outcome,
    status,
    disposition,
    leadId,
    patientId,
    messageId,
  });
  return { status, disposition, leadId, patientId, messageId };
}

function toResult(
  callEventId: number,
  duplicate: boolean,
  summary: Pick<IngestCallResult, 'status' | 'disposition' | 'leadId' | 'patientId' | 'messageId'>,
): IngestCallResult {
  return { duplicate, callEventId, ...summary };
}

export async function ingestCallEvent(
  db: Pool,
  logger: Logger,
  input: IngestCallInput,
): Promise<IngestCallResult> {
  const { event } = input;
  const phone = normalizePhone(event.from, 'from');

  let callEventId: number;
  try {
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO call_events
        (organization_id, provider_key, provider_event_id, provider_status, call_outcome,
         caller_number, called_number, occurred_at, status, disposition, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RECORDED', 'no_action', ?)`,
      [
        input.organizationId,
        input.providerKey,
        event.eventId,
        event.providerStatus,
        event.outcome,
        phone,
        event.to,
        event.occurredAt,
        input.rawPayload,
      ],
    );
    callEventId = result.insertId;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      const [dupes] = await db.query<EventRow[]>(
        `SELECT id, status, disposition, lead_id, patient_id, message_id
         FROM call_events WHERE provider_key = ? AND provider_event_id = ?`,
        [input.providerKey, event.eventId],
      );
      const existing = dupes[0];
      if (existing !== undefined) {
        logger.info('call event duplicate ignored', {
          callEventId: existing.id,
          providerEventId: event.eventId,
          status: existing.status,
        });
        if (existing.status === 'RECORDED' && RECOVERY_OUTCOMES.includes(event.outcome)) {
          const summary = await recover(
            db,
            logger,
            input.organizationId,
            input.providerKey,
            event,
            existing.id,
            phone,
          );
          return toResult(existing.id, true, summary);
        }
        return toResult(existing.id, true, {
          status: existing.status,
          disposition: existing.disposition,
          leadId: existing.lead_id,
          patientId: existing.patient_id,
          messageId: existing.message_id,
        });
      }
    }
    throw err;
  }

  if (!RECOVERY_OUTCOMES.includes(event.outcome)) {
    logger.info('call event recorded', {
      callEventId,
      outcome: event.outcome,
      providerStatus: event.providerStatus,
    });
    return toResult(callEventId, false, {
      status: 'RECORDED',
      disposition: 'no_action',
      leadId: null,
      patientId: null,
      messageId: null,
    });
  }

  const summary = await recover(
    db,
    logger,
    input.organizationId,
    input.providerKey,
    event,
    callEventId,
    phone,
  );
  return toResult(callEventId, false, summary);
}

export interface CallEventRow extends RowDataPacket {
  id: number;
  organization_id: number;
  provider_key: string;
  provider_event_id: string;
  status: string;
  disposition: string;
  lead_id: number | null;
  patient_id: number | null;
  message_id: number | null;
}

export async function loadCallEvent(
  db: Pool,
  organizationId: number,
  callEventId: number,
): Promise<CallEventRow | null> {
  const [rows] = await db.query<CallEventRow[]>(
    'SELECT * FROM call_events WHERE id = ? AND organization_id = ?',
    [callEventId, organizationId],
  );
  return rows[0] ?? null;
}
