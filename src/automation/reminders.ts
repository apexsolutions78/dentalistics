import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { getProvider } from '../communications/registry';
import { sendTemplateMessage, sendMessage } from '../services/messages';
import type { ReminderConfig } from './reminderConfig';
import { DEFAULT_REMINDER_TEMPLATE_2H, loadReminderConfig } from './reminderConfig';
import { clinicLocalTime, isWithinQuietHours, zonedToUtc } from './time';

const HOUR_MS = 3_600_000;

interface ScheduleRow extends RowDataPacket {
  id: number;
  organization_id: number;
  status: string;
  appointment_date: string;
  appointment_time: string;
  timezone: string;
}

interface ReminderRow extends RowDataPacket {
  id: number;
  organization_id: number;
  appointment_id: number;
  offset_hours: number;
  status: string;
  message_id: number | null;
  attempts: number;
  scheduled_at: Date;
}

interface ContextRow extends RowDataPacket {
  appointment_id: number;
  organization_id: number;
  status: string;
  appointment_date: string;
  appointment_time: string;
  timezone: string;
  org_name: string;
  patient_id: number;
  phone: string;
  first_name: string;
  sms_opt_out: number | boolean;
}

interface MessageStateRow extends RowDataPacket {
  status: string;
  provider_error: string | null;
}

function isDuplicate(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY';
}

export async function scheduleRemindersForAppointment(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<{ scheduled: number; skipped: number }> {
  const [rows] = await db.query<ScheduleRow[]>(
    `SELECT a.id, a.organization_id, a.status,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
       a.appointment_time, o.timezone
     FROM appointments a
     JOIN organizations o ON o.id = a.organization_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  const appt = rows[0];
  if (appt === undefined) {
    return { scheduled: 0, skipped: 0 };
  }
  if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
    return { scheduled: 0, skipped: 1 };
  }

  const cfg = await loadReminderConfig(db);
  const now = Date.now();
  const appointmentInstant = zonedToUtc(
    appt.appointment_date,
    appt.appointment_time,
    appt.timezone,
  ).getTime();

  let scheduled = 0;
  let skipped = 0;
  for (const offset of cfg.offsetsHours) {
    const at = new Date(appointmentInstant - offset * HOUR_MS);
    if (at.getTime() <= now) {
      skipped += 1;
      continue;
    }
    try {
      await db.query(
        `INSERT INTO appointment_reminders (organization_id, appointment_id, offset_hours, scheduled_at)
         VALUES (?, ?, ?, ?)`,
        [appt.organization_id, appointmentId, offset, at],
      );
      scheduled += 1;
    } catch (err) {
      if (isDuplicate(err)) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  logger.info('appointment reminders scheduled', { appointmentId, scheduled, skipped });
  return { scheduled, skipped };
}

export async function cancelRemindersForAppointment(
  db: Pool,
  logger: Logger,
  appointmentId: number,
  reason: string,
): Promise<{ cancelled: number }> {
  const [result] = await db.query(
    `UPDATE appointment_reminders
     SET status = 'CANCELLED', suppression_reason = ?
     WHERE appointment_id = ? AND status IN ('PENDING', 'FAILED', 'SENDING')`,
    [reason.slice(0, 64), appointmentId],
  );
  const cancelled = (result as { affectedRows: number }).affectedRows;
  if (cancelled > 0) {
    logger.info('appointment reminders cancelled', { appointmentId, reason, cancelled });
  }
  return { cancelled };
}

export interface TickResult {
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  cancelled: number;
}

interface FinalizeFields {
  status: 'SENT' | 'FAILED' | 'SUPPRESSED' | 'CANCELLED';
  messageId?: number | null;
  lastError?: string | null;
  suppressionReason?: string | null;
  sentAt?: Date | null;
  scheduledAt?: Date | null;
}

async function finalizeSending(
  db: Pool,
  reminderId: number,
  fields: FinalizeFields,
): Promise<boolean> {
  const [result] = await db.query(
    `UPDATE appointment_reminders
     SET status = ?,
         message_id = COALESCE(?, message_id),
         last_error = ?,
         suppression_reason = ?,
         sent_at = ?,
         scheduled_at = COALESCE(?, scheduled_at)
     WHERE id = ? AND status = 'SENDING'`,
    [
      fields.status,
      fields.messageId ?? null,
      fields.lastError ?? null,
      fields.suppressionReason ?? null,
      fields.sentAt ?? null,
      fields.scheduledAt ?? null,
      reminderId,
    ],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

function backoffFrom(now: Date, attempts: number): Date {
  return new Date(now.getTime() + 60_000 * 2 ** Math.max(0, attempts - 1));
}

async function loadContext(db: Pool, appointmentId: number): Promise<ContextRow | null> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT a.id AS appointment_id, a.organization_id, a.status,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
       a.appointment_time, o.timezone, o.name AS org_name,
       p.id AS patient_id, p.phone, p.first_name, p.sms_opt_out
     FROM appointments a
     JOIN organizations o ON o.id = a.organization_id
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  return rows[0] ?? null;
}

async function loadMessageState(db: Pool, messageId: number): Promise<MessageStateRow | null> {
  const [rows] = await db.query<MessageStateRow[]>(
    'SELECT status, provider_error FROM communication_messages WHERE id = ?',
    [messageId],
  );
  return rows[0] ?? null;
}

async function processReminder(
  db: Pool,
  logger: Logger,
  cfg: ReminderConfig,
  row: ReminderRow,
  now: Date,
  result: TickResult,
): Promise<void> {
  const claimedAttempts = row.attempts + 1;
  const [claim] = await db.query(
    `UPDATE appointment_reminders
     SET status = 'SENDING', attempts = ?
     WHERE id = ? AND status = ? AND attempts = ?`,
    [claimedAttempts, row.id, row.status, row.attempts],
  );
  if ((claim as { affectedRows: number }).affectedRows === 0) {
    return;
  }
  result.processed += 1;

  try {
    const ctx = await loadContext(db, row.appointment_id);
    if (ctx === null || (ctx.status !== 'SCHEDULED' && ctx.status !== 'CONFIRMED')) {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'appointment_inactive',
        })
      ) {
        result.cancelled += 1;
      }
      return;
    }

    if (ctx.sms_opt_out === true || ctx.sms_opt_out === 1) {
      if (
        await finalizeSending(db, row.id, {
          status: 'SUPPRESSED',
          suppressionReason: 'communication_not_permitted',
        })
      ) {
        result.suppressed += 1;
      }
      return;
    }

    if (
      cfg.quietHours.enabled &&
      isWithinQuietHours(
        clinicLocalTime(now, ctx.timezone),
        cfg.quietHours.start,
        cfg.quietHours.end,
      )
    ) {
      if (
        await finalizeSending(db, row.id, {
          status: 'SUPPRESSED',
          suppressionReason: 'quiet_hours',
        })
      ) {
        result.suppressed += 1;
      }
      return;
    }

    const provider = getProvider(cfg.provider);
    const appointmentTime = ctx.appointment_time.slice(0, 5);
    let finalMessageId: number | null = row.message_id;
    let outcome: string;

    if (row.message_id === null) {
      const template =
        cfg.templates[String(row.offset_hours)] ?? DEFAULT_REMINDER_TEMPLATE_2H;
      const sent = await sendTemplateMessage(db, logger, provider, {
        organizationId: row.organization_id,
        channel: cfg.channel,
        to: ctx.phone,
        templateText: template,
        templateName: `appointment_reminder_${row.offset_hours}h`,
        variables: {
          first_name: ctx.first_name,
          clinic_name: ctx.org_name,
          appointment_date: ctx.appointment_date,
          appointment_time: appointmentTime,
        },
        idempotencyKey: `reminder:${row.id}`,
        messageType: 'appointment_reminder',
      });
      finalMessageId = (sent.message.id as number) ?? null;
      outcome = sent.outcome;
    } else {
      const sent = await sendMessage(
        db,
        logger,
        provider,
        row.organization_id,
        row.message_id,
      );
      outcome = sent.outcome;
    }

    if (outcome === 'sent') {
      if (
        await finalizeSending(db, row.id, {
          status: 'SENT',
          messageId: finalMessageId,
          sentAt: now,
          lastError: null,
        })
      ) {
        result.sent += 1;
      }
      logger.info('appointment reminder sent', {
        reminderId: row.id,
        appointmentId: row.appointment_id,
        offsetHours: row.offset_hours,
        messageId: finalMessageId,
      });
      return;
    }

    if (outcome === 'failed') {
      const state = finalMessageId === null ? null : await loadMessageState(db, finalMessageId);
      const error = state?.provider_error ?? 'provider_error';
      if (
        await finalizeSending(db, row.id, {
          status: 'FAILED',
          messageId: finalMessageId,
          lastError: error.slice(0, 1000),
          scheduledAt: backoffFrom(now, claimedAttempts),
        })
      ) {
        result.failed += 1;
      }
      logger.warn('appointment reminder send failed', {
        reminderId: row.id,
        appointmentId: row.appointment_id,
        attempts: claimedAttempts,
      });
      return;
    }

    const state = finalMessageId === null ? null : await loadMessageState(db, finalMessageId);
    if (state !== null && (state.status === 'SENT' || state.status === 'DELIVERED')) {
      if (
        await finalizeSending(db, row.id, {
          status: 'SENT',
          messageId: finalMessageId,
          sentAt: now,
          lastError: null,
        })
      ) {
        result.sent += 1;
      }
      return;
    }
    if (
      await finalizeSending(db, row.id, {
        status: 'FAILED',
        messageId: finalMessageId,
        lastError: (state?.provider_error ?? 'message_not_dispatchable').slice(0, 1000),
        scheduledAt: backoffFrom(now, claimedAttempts),
      })
    ) {
      result.failed += 1;
    }
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (
      await finalizeSending(db, row.id, {
        status: 'FAILED',
        lastError: text.slice(0, 1000),
        scheduledAt: backoffFrom(now, claimedAttempts),
      })
    ) {
      result.failed += 1;
    }
    logger.error('appointment reminder processing error', {
      reminderId: row.id,
      appointmentId: row.appointment_id,
      error: text,
    });
  }
}

export interface TickOptions {
  now?: Date;
  batchSize?: number;
}

export async function runReminderTick(
  db: Pool,
  logger: Logger,
  options: TickOptions = {},
): Promise<TickResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const result: TickResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    cancelled: 0,
  };

  const cfg = await loadReminderConfig(db);
  if (!cfg.enabled) {
    return result;
  }

  await db.query(
    `UPDATE appointment_reminders
     SET status = 'FAILED', last_error = COALESCE(last_error, 'interrupted'),
         scheduled_at = ?
     WHERE status = 'SENDING' AND updated_at < DATE_SUB(?, INTERVAL 600 SECOND)`,
    [now, now],
  );

  const [due] = await db.query<ReminderRow[]>(
    `SELECT id, organization_id, appointment_id, offset_hours, status, message_id, attempts, scheduled_at
     FROM appointment_reminders
     WHERE (status = 'PENDING' OR (status = 'FAILED' AND attempts < ?))
       AND scheduled_at <= ?
     ORDER BY scheduled_at ASC, id ASC
     LIMIT ?`,
    [cfg.maxAttempts, now, batchSize],
  );

  for (const row of due) {
    await processReminder(db, logger, cfg, row, now, result);
  }

  if (result.processed > 0) {
    logger.info('reminder tick finished', { ...result });
  }
  return result;
}
