import type { Pool, RowDataPacket } from 'mysql2/promise';
import { clinicLocalDate, clinicLocalTime } from '../automation/time';
import type { LeadAutomationConfig } from '../automation/leadAutomationConfig';
import { loadLeadAutomationConfig } from '../automation/leadAutomationConfig';
import { APPOINTMENT_CONFIRMATION_TEMPLATE_NAME } from '../communications/template';
import { getProvider } from '../communications/registry';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { markLeadAppointmentBooked, recordLeadActivity } from './leads';
import { getAppointment } from './appointments';
import { sendTemplateMessage } from './messages';
import {
  assertSlotAvailable,
  loadBusyIntervals,
  loadOrgTimezone,
} from './doctors';
import { MIN_LEAD_MINUTES, dateAddDays, dayKeyForDate, enumerateSlots, parseWorkHours, slotConflicts, toMinutes } from './slots';
import type { UrgencyResult } from './urgency';
import { parseDateOnly, parseTimeOnly } from '../validate';

export const SUGGESTION_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'RESCHEDULED',
  'DECLINED',
  'EXPIRED',
] as const;

export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

interface SuggestionRow extends RowDataPacket {
  id: number;
  organization_id: number;
  lead_id: number;
  doctor_id: number;
  slot_date: string;
  slot_time: string;
  urgency_level: string;
  status: string;
  appointment_id: number | null;
  decided_by: number | null;
  decided_at: Date | null;
  created_at: Date;
  doctor_name: string | null;
  doctor_specialty: string | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  organization_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  requested_service: string | null;
  status: string;
}

interface DoctorCandidateRow extends RowDataPacket {
  id: number;
  work_hours: string;
  slot_minutes: number;
  name: string;
}

interface OrgRow extends RowDataPacket {
  id: number;
  name: string;
  phone: string | null;
}

const SUGGESTION_SELECT = `SELECT s.id, s.organization_id, s.lead_id, s.doctor_id,
    DATE_FORMAT(s.slot_date, '%Y-%m-%d') AS slot_date,
    s.slot_time, s.urgency_level, s.status, s.appointment_id, s.decided_by, s.decided_at,
    s.created_at, d.name AS doctor_name, d.specialty AS doctor_specialty
  FROM lead_slot_suggestions s
  LEFT JOIN doctors d ON d.id = s.doctor_id`;

function suggestionDto(row: SuggestionRow): Record<string, unknown> {
  return {
    id: row.id,
    leadId: row.lead_id,
    doctorId: row.doctor_id,
    doctor:
      row.doctor_name === null
        ? null
        : { id: row.doctor_id, name: row.doctor_name, specialty: row.doctor_specialty },
    slotDate: row.slot_date,
    slotTime: row.slot_time,
    urgencyLevel: row.urgency_level,
    status: row.status,
    appointmentId: row.appointment_id,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

async function loadLeadRow(db: Pool, organizationId: number, leadId: number): Promise<LeadRow | null> {
  const [rows] = await db.query<LeadRow[]>(
    `SELECT id, organization_id, first_name, last_name, phone, email, requested_service, status
     FROM leads WHERE id = ? AND organization_id = ?`,
    [leadId, organizationId],
  );
  return rows[0] ?? null;
}

async function expirePendingSuggestions(
  db: Pool,
  leadId: number,
  localDate: string,
  localTime: string,
): Promise<number> {
  const [result] = await db.query(
    `UPDATE lead_slot_suggestions SET status = 'EXPIRED'
     WHERE lead_id = ? AND status = 'PENDING'
       AND (slot_date < ? OR (slot_date = ? AND slot_time < ?))`,
    [leadId, localDate, localDate, localTime],
  );
  return (result as { affectedRows: number }).affectedRows;
}

export async function expirePendingForLead(
  db: Pool,
  organizationId: number,
  leadId: number,
): Promise<number> {
  const timezone = await loadOrgTimezone(db, organizationId);
  const now = new Date();
  return expirePendingSuggestions(
    db,
    leadId,
    clinicLocalDate(now, timezone),
    clinicLocalTime(now, timezone),
  );
}

export async function listSuggestionsForLead(
  db: Pool,
  organizationId: number,
  leadId: number,
): Promise<Array<Record<string, unknown>>> {
  const timezone = await loadOrgTimezone(db, organizationId);
  const now = new Date();
  await expirePendingSuggestions(
    db,
    leadId,
    clinicLocalDate(now, timezone),
    clinicLocalTime(now, timezone),
  );
  const [rows] = await db.query<SuggestionRow[]>(
    `${SUGGESTION_SELECT} WHERE s.lead_id = ? AND s.organization_id = ?
     ORDER BY FIELD(s.status, 'PENDING', 'RESCHEDULED', 'ACCEPTED', 'DECLINED', 'EXPIRED'),
       s.slot_date ASC, s.slot_time ASC, s.id ASC`,
    [leadId, organizationId],
  );
  return rows.map(suggestionDto);
}

export async function generateSuggestions(
  db: Pool,
  logger: Logger,
  organizationId: number,
  leadId: number,
  config: LeadAutomationConfig,
  urgency: UrgencyResult,
): Promise<number> {
  const [doctorRows] = await db.query<DoctorCandidateRow[]>(
    `SELECT id, name, work_hours, slot_minutes FROM doctors
     WHERE organization_id = ? AND is_active = 1
     ORDER BY id ASC`,
    [organizationId],
  );
  if (doctorRows.length === 0) {
    logger.info('lead suggestions skipped', { organizationId, leadId, reason: 'no_active_doctors' });
    return 0;
  }
  const timezone = await loadOrgTimezone(db, organizationId);
  const now = new Date();
  const localDate = clinicLocalDate(now, timezone);
  const localTime = clinicLocalTime(now, timezone);
  const horizon = Math.min(config.slaDays[urgency.level.toLowerCase() as 'high' | 'medium' | 'low'], config.lookaheadDays);
  const horizonEnd = dateAddDays(localDate, horizon - 1);
  const nowMinutes = toMinutes(localTime) + MIN_LEAD_MINUTES;

  interface Candidate {
    doctorId: number;
    date: string;
    time: string;
  }
  const candidates: Candidate[] = [];

  for (const doctor of doctorRows) {
    const hours = parseWorkHours(doctor.work_hours);
    if (hours === null) {
      continue;
    }
    const busy = await loadBusyIntervals(
      db,
      organizationId,
      doctor.id,
      localDate,
      horizonEnd,
      doctor.slot_minutes,
    );
    for (let offset = 0; offset < horizon; offset += 1) {
      const date = dateAddDays(localDate, offset);
      const window = hours[dayKeyForDate(date)];
      if (window === null) {
        continue;
      }
      const busyForDate = busy.get(date) ?? [];
      for (const slot of enumerateSlots(window, doctor.slot_minutes)) {
        if (offset === 0 && toMinutes(slot) < nowMinutes) {
          continue;
        }
        if (slotConflicts(slot, doctor.slot_minutes, busyForDate)) {
          continue;
        }
        candidates.push({ doctorId: doctor.id, date, time: slot });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.doctorId - b.doctorId;
  });

  const chosen = candidates.slice(0, config.slotsCount);
  for (const candidate of chosen) {
    await db.query(
      `INSERT INTO lead_slot_suggestions (organization_id, lead_id, doctor_id, slot_date, slot_time, urgency_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [organizationId, leadId, candidate.doctorId, candidate.date, candidate.time, urgency.level],
    );
  }
  if (chosen.length > 0) {
    logger.info('lead suggestions generated', {
      organizationId,
      leadId,
      count: chosen.length,
      urgency: urgency.level,
    });
  } else {
    logger.info('lead suggestions skipped', { organizationId, leadId, reason: 'no_free_slots' });
  }
  return chosen.length;
}

interface LoadedSuggestion extends SuggestionRow {
  status: string;
}

async function loadSuggestion(
  db: Pool,
  organizationId: number,
  leadId: number,
  suggestionId: number,
): Promise<LoadedSuggestion | null> {
  const [rows] = await db.query<SuggestionRow[]>(
    `${SUGGESTION_SELECT} WHERE s.id = ? AND s.lead_id = ? AND s.organization_id = ?`,
    [suggestionId, leadId, organizationId],
  );
  return rows[0] ?? null;
}

const UNBOOKABLE_LEAD_STATUSES = ['LOST', 'CLOSED', 'APPOINTMENT_BOOKED'];

async function findOrCreatePatientForLead(
  db: Pool,
  logger: Logger,
  lead: LeadRow,
  actorId: number,
): Promise<number> {
  const [existing] = await db.query<RowDataPacket[]>(
    'SELECT id FROM patients WHERE organization_id = ? AND phone = ?',
    [lead.organization_id, lead.phone],
  );
  const existingId = existing[0]?.id;
  if (typeof existingId === 'number') {
    return existingId;
  }
  try {
    const [result] = await db.query(
      `INSERT INTO patients (organization_id, first_name, last_name, phone, email, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lead.organization_id,
        lead.first_name,
        lead.last_name,
        lead.phone,
        lead.email,
        'Converted from lead during appointment approval',
        actorId,
      ],
    );
    return (result as { insertId: number }).insertId;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      const [retry] = await db.query<RowDataPacket[]>(
        'SELECT id FROM patients WHERE organization_id = ? AND phone = ?',
        [lead.organization_id, lead.phone],
      );
      const retryId = retry[0]?.id;
      if (typeof retryId === 'number') {
        return retryId;
      }
    }
    logger.error('patient conversion for suggestion failed', {
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function sendAppointmentConfirmation(
  db: Pool,
  logger: Logger,
  lead: LeadRow,
  appointmentId: number,
  date: string,
  time: string,
): Promise<void> {
  const config = await loadLeadAutomationConfig(db, lead.organization_id);
  if (!config.enabled) {
    return;
  }
  const [orgRows] = await db.query<OrgRow[]>(
    'SELECT id, name, phone FROM organizations WHERE id = ?',
    [lead.organization_id],
  );
  const org = orgRows[0];
  if (org === undefined) {
    return;
  }
  const result = await sendTemplateMessage(db, logger, getProvider(config.provider), {
    organizationId: lead.organization_id,
    channel: config.channel,
    to: lead.phone,
    templateName: APPOINTMENT_CONFIRMATION_TEMPLATE_NAME,
    templateText: config.template,
    variables: {
      first_name: lead.first_name,
      clinic_name: org.name,
      appointment_date: date,
      appointment_time: time.slice(0, 5),
      clinic_phone: org.phone ?? '',
    },
    idempotencyKey: `apptconfirm:${appointmentId}`,
    leadId: lead.id,
    messageType: APPOINTMENT_CONFIRMATION_TEMPLATE_NAME,
  });
  logger.info('appointment confirmation result', {
    leadId: lead.id,
    appointmentId,
    messageId: (result.message as { id?: unknown }).id,
    outcome: result.outcome,
  });
}

export interface ApproveSuggestionInput {
  organizationId: number;
  leadId: number;
  suggestionId: number;
  actorId: number;
  body: unknown;
}

export async function approveSuggestion(
  db: Pool,
  logger: Logger,
  input: ApproveSuggestionInput,
): Promise<{ appointment: Record<string, unknown>; suggestion: Record<string, unknown> }> {
  if (input.body !== null && typeof input.body !== 'object') {
    throw new ValidationError('Invalid input', ['body must be a JSON object']);
  }
  const body = (input.body ?? {}) as Record<string, unknown>;

  const suggestion = await loadSuggestion(db, input.organizationId, input.leadId, input.suggestionId);
  if (suggestion === null) {
    throw new AppError('Suggestion not found', 404, 'not_found', true);
  }
  if (suggestion.status !== 'PENDING') {
    throw new AppError('This suggestion has already been decided', 409, 'suggestion_not_pending', true);
  }
  const lead = await loadLeadRow(db, input.organizationId, input.leadId);
  if (lead === null) {
    throw new AppError('Lead not found', 404, 'not_found', true);
  }
  if (UNBOOKABLE_LEAD_STATUSES.includes(lead.status)) {
    throw new AppError('This lead no longer awaits an appointment', 409, 'lead_not_bookable', true);
  }

  const date = body.date === undefined ? suggestion.slot_date : parseDateOnly(body.date, 'date');
  const time = body.time === undefined ? suggestion.slot_time : parseTimeOnly(body.time, 'time');
  const timezone = await loadOrgTimezone(db, input.organizationId);
  const now = new Date();
  const localDate = clinicLocalDate(now, timezone);
  const localTime = clinicLocalTime(now, timezone);
  if (date < localDate || (date === localDate && time.slice(0, 5) < localTime)) {
    await db.query(
      `UPDATE lead_slot_suggestions SET status = 'EXPIRED', decided_by = ?, decided_at = UTC_TIMESTAMP()
       WHERE id = ? AND status = 'PENDING'`,
      [input.actorId, suggestion.id],
    );
    throw new AppError('That slot is in the past; refresh the suggestions', 409, 'suggestion_expired', true);
  }

  await assertSlotAvailable(db, input.organizationId, suggestion.doctor_id, date, time, {
    excludeSuggestionId: suggestion.id,
  });

  const patientId = await findOrCreatePatientForLead(db, logger, lead, input.actorId);
  const rescheduled = date !== suggestion.slot_date || time !== suggestion.slot_time;
  const finalStatus = rescheduled ? 'RESCHEDULED' : 'ACCEPTED';

  const [insertResult] = await db.query(
    `INSERT INTO appointments
       (organization_id, patient_id, lead_id, appointment_date, appointment_time,
        status, service, doctor_id, created_by)
     VALUES (?, ?, ?, ?, ?, 'SCHEDULED', ?, ?, ?)`,
    [
      input.organizationId,
      patientId,
      lead.id,
      date,
      time,
      lead.requested_service,
      suggestion.doctor_id,
      input.actorId,
    ],
  );
  const appointmentId = (insertResult as { insertId: number }).insertId;

  const [updateResult] = await db.query(
    `UPDATE lead_slot_suggestions
     SET status = ?, appointment_id = ?, decided_by = ?, decided_at = UTC_TIMESTAMP()
     WHERE id = ? AND status = 'PENDING'`,
    [finalStatus, appointmentId, input.actorId, suggestion.id],
  );
  if ((updateResult as { affectedRows: number }).affectedRows === 0) {
    logger.warn('suggestion decided concurrently', {
      suggestionId: suggestion.id,
      appointmentId,
    });
  }

  await markLeadAppointmentBooked(db, logger, {
    organizationId: input.organizationId,
    leadId: lead.id,
    actorId: input.actorId,
  });

  const doctorLabel = suggestion.doctor_name ?? 'the clinic';
  await recordLeadActivity(
    db,
    logger,
    lead.id,
    input.actorId,
    rescheduled ? 'suggestion_rescheduled' : 'suggestion_accepted',
    `${date} ${time.slice(0, 5)} with ${doctorLabel}`,
  );

  try {
    await sendAppointmentConfirmation(db, logger, lead, appointmentId, date, time);
  } catch (err) {
    logger.error('appointment confirmation failed', {
      appointmentId,
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('lead suggestion decided', {
    organizationId: input.organizationId,
    leadId: lead.id,
    suggestionId: suggestion.id,
    appointmentId,
    status: finalStatus,
  });

  const updatedSuggestion = await loadSuggestion(db, input.organizationId, input.leadId, suggestion.id);
  const appointment = await getAppointment(db, input.organizationId, appointmentId);
  if (appointment === null) {
    throw new AppError('Appointment not found', 404, 'not_found', true);
  }
  return {
    appointment: appointment.appointment as Record<string, unknown>,
    suggestion: suggestionDto(updatedSuggestion as LoadedSuggestion),
  };
}

export async function declineSuggestion(
  db: Pool,
  logger: Logger,
  organizationId: number,
  leadId: number,
  suggestionId: number,
  actorId: number,
): Promise<Record<string, unknown>> {
  const suggestion = await loadSuggestion(db, organizationId, leadId, suggestionId);
  if (suggestion === null) {
    throw new AppError('Suggestion not found', 404, 'not_found', true);
  }
  if (suggestion.status !== 'PENDING') {
    throw new AppError('This suggestion has already been decided', 409, 'suggestion_not_pending', true);
  }
  const [result] = await db.query(
    `UPDATE lead_slot_suggestions
     SET status = 'DECLINED', decided_by = ?, decided_at = UTC_TIMESTAMP()
     WHERE id = ? AND status = 'PENDING'`,
    [actorId, suggestionId],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    throw new AppError('This suggestion has already been decided', 409, 'suggestion_not_pending', true);
  }
  await recordLeadActivity(
    db,
    logger,
    leadId,
    actorId,
    'suggestion_declined',
    `${suggestion.slot_date} ${suggestion.slot_time.slice(0, 5)} with ${suggestion.doctor_name ?? 'the clinic'}`,
  );
  logger.info('lead suggestion declined', { organizationId, leadId, suggestionId });
  const updated = await loadSuggestion(db, organizationId, leadId, suggestionId);
  return suggestionDto(updated as LoadedSuggestion);
}
