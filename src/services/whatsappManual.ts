import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { clinicMaySend } from '../billing/entitlement';
import { loadRecallConfig } from '../automation/recallConfig';
import { DEFAULT_REMINDER_TEMPLATE_48H, loadReminderConfig } from '../automation/reminderConfig';
import { zonedToUtc } from '../automation/time';
import { pickReminderOffset } from '../communications/reminderPick';
import { renderTemplate } from '../communications/template';
import {
  manualWhatsAppDelivery,
  toE164,
  type WhatsAppDeliveryProvider,
} from '../communications/whatsappDelivery';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import { messageDto, type MessageRow } from './messages';

export type WhatsAppSubjectKind = 'appointment' | 'recall';

interface AppointmentContext extends RowDataPacket {
  id: number;
  lead_id: number | null;
  appointment_date: string;
  appointment_time: string;
  org_name: string;
  clinic_phone: string | null;
  timezone: string;
  patient_id: number;
  phone: string;
  first_name: string;
  sms_opt_out: number | boolean;
}

interface RecallContext extends RowDataPacket {
  id: number;
  recall_type: string;
  due_date: string;
  org_name: string;
  clinic_phone: string | null;
  patient_id: number;
  phone: string;
  first_name: string;
  sms_opt_out: number | boolean;
}

function optedOut(value: number | boolean): boolean {
  return value === true || value === 1;
}

export interface DeliverWhatsAppInput {
  organizationId: number;
  actorId: number;
  kind: WhatsAppSubjectKind;
  subjectId: number;
  provider?: WhatsAppDeliveryProvider;
  now?: Date;
}

export async function deliverWhatsAppReminder(
  db: Pool,
  logger: Logger,
  input: DeliverWhatsAppInput,
): Promise<Record<string, unknown>> {
  if (!(await clinicMaySend(db, input.organizationId))) {
    throw new AppError(
      'This clinic is read-only, so a WhatsApp message cannot be logged.',
      403,
      'billing_read_only',
      true,
    );
  }

  const provider = input.provider ?? manualWhatsAppDelivery();
  const now = input.now ?? new Date();
  const prepared =
    input.kind === 'appointment'
      ? await prepareAppointment(db, input.organizationId, input.subjectId, now)
      : await prepareRecall(db, input.organizationId, input.subjectId);

  if (optedOut(prepared.smsOptOut)) {
    throw new AppError(
      'This patient has opted out of messages.',
      403,
      'consent_suppressed',
      true,
    );
  }

  const phoneE164 = toE164(prepared.phone);
  const idempotencyKey = `wa-manual:${randomUUID()}`;
  const [inserted] = await db.query<ResultSetHeader>(
    `INSERT INTO communication_messages
       (organization_id, channel, recipient, body, status, direction, message_type, template,
        lead_id, idempotency_key, attempts)
     VALUES (?, 'WHATSAPP', ?, ?, 'PENDING', 'OUTBOUND', ?, ?, ?, ?, 0)`,
    [
      input.organizationId,
      prepared.phone,
      prepared.body,
      prepared.messageType,
      prepared.templateName,
      prepared.leadId,
      idempotencyKey,
    ],
  );
  const messageId = inserted.insertId;

  try {
    const handoff = await provider.handoff({ toE164: phoneE164, body: prepared.body });
    await db.query(
      `UPDATE communication_messages
       SET status = 'SENT', provider_key = ?, provider_message_id = ?, provider_error = NULL,
           attempts = 1, sent_at = UTC_TIMESTAMP()
       WHERE id = ? AND organization_id = ?`,
      [handoff.providerKey, handoff.providerMessageId, messageId, input.organizationId],
    );
    await recordAudit(db, logger, {
      organizationId: input.organizationId,
      userId: input.actorId,
      action: 'whatsapp_manual_sent',
      detail: `kind=${input.kind} subject=${input.subjectId} message=${messageId} patient=${prepared.patientId}`.slice(0, 255),
    });
    logger.info('whatsapp handoff logged', {
      messageId,
      organizationId: input.organizationId,
      kind: input.kind,
      subjectId: input.subjectId,
      provider: handoff.providerKey,
      mode: handoff.mode,
    });
    const message = await loadMessage(db, input.organizationId, messageId);
    return {
      url: handoff.url,
      phoneE164,
      body: prepared.body,
      template: prepared.templateName,
      message,
    };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE communication_messages
       SET status = 'FAILED', provider_key = ?, provider_error = ?, attempts = 1
       WHERE id = ? AND organization_id = ? AND status = 'PENDING'`,
      [provider.key, text.slice(0, 1000), messageId, input.organizationId],
    );
    logger.error('whatsapp handoff failed', {
      messageId,
      organizationId: input.organizationId,
      provider: provider.key,
      error: text.slice(0, 300),
    });
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('WhatsApp handoff failed', 502, 'whatsapp_handoff_failed', true);
  }
}

interface PreparedSend {
  phone: string;
  smsOptOut: number | boolean;
  patientId: number;
  leadId: number | null;
  body: string;
  templateName: string;
  messageType: string;
}

async function prepareAppointment(
  db: Pool,
  organizationId: number,
  appointmentId: number,
  now: Date,
): Promise<PreparedSend> {
  const [rows] = await db.query<AppointmentContext[]>(
    `SELECT a.id, a.lead_id,
            DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
            a.appointment_time,
            o.name AS org_name, o.phone AS clinic_phone, o.timezone,
            p.id AS patient_id, p.phone, p.first_name, p.sms_opt_out
     FROM appointments a
     JOIN organizations o ON o.id = a.organization_id
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = ? AND a.organization_id = ?`,
    [appointmentId, organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Appointment not found', 404, 'not_found', true);
  }
  const cfg = await loadReminderConfig(db, organizationId);
  const instant = zonedToUtc(row.appointment_date, String(row.appointment_time).slice(0, 8), row.timezone);
  const hoursUntil = (instant.getTime() - now.getTime()) / 3_600_000;
  const offset = pickReminderOffset(hoursUntil, cfg.offsetsHours);
  const templateText = cfg.templates[String(offset)] ?? DEFAULT_REMINDER_TEMPLATE_48H;
  const templateName = `appointment_reminder_${offset}h`;
  const body = renderTemplate(templateText, {
    first_name: row.first_name,
    clinic_name: row.org_name,
    clinic_phone: row.clinic_phone ?? '',
    appointment_date: row.appointment_date,
    appointment_time: String(row.appointment_time).slice(0, 5),
  });
  return {
    phone: row.phone,
    smsOptOut: row.sms_opt_out,
    patientId: row.patient_id,
    leadId: row.lead_id,
    body,
    templateName,
    messageType: 'appointment_reminder',
  };
}

async function prepareRecall(
  db: Pool,
  organizationId: number,
  recallId: number,
): Promise<PreparedSend> {
  const [rows] = await db.query<RecallContext[]>(
    `SELECT r.id, r.recall_type, DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due_date,
            o.name AS org_name, o.phone AS clinic_phone,
            p.id AS patient_id, p.phone, p.first_name, p.sms_opt_out
     FROM recalls r
     JOIN organizations o ON o.id = r.organization_id
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = ? AND r.organization_id = ?`,
    [recallId, organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Recall not found', 404, 'not_found', true);
  }
  const cfg = await loadRecallConfig(db, organizationId);
  const body = renderTemplate(cfg.templates.recall, {
    first_name: row.first_name,
    clinic_name: row.org_name,
    clinic_phone: row.clinic_phone ?? '',
    due_date: row.due_date,
    interval_days: String(cfg.intervalDays),
    recall_type: row.recall_type,
  });
  return {
    phone: row.phone,
    smsOptOut: row.sms_opt_out,
    patientId: row.patient_id,
    leadId: null,
    body,
    templateName: 'recall_message',
    messageType: 'recall_message',
  };
}

async function loadMessage(
  db: Pool,
  organizationId: number,
  messageId: number,
): Promise<Record<string, unknown>> {
  const [rows] = await db.query<MessageRow[]>(
    'SELECT * FROM communication_messages WHERE id = ? AND organization_id = ?',
    [messageId, organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Message not found', 404, 'not_found', true);
  }
  return messageDto(row);
}
