import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { getProvider } from '../communications/registry';
import { sendTemplateMessage, sendMessage } from '../services/messages';
import type { NoShowConfig } from './noShowConfig';
import { loadNoShowConfig } from './noShowConfig';

const HOUR_MS = 3_600_000;

interface CaseRow extends RowDataPacket {
  id: number;
  organization_id: number;
  appointment_id: number;
}

interface OpenCaseRow extends CaseRow {
  patient_id: number;
  rebooked_id: number | null;
}

interface NoShowMessageRow extends RowDataPacket {
  id: number;
  case_id: number;
  organization_id: number;
  phase: string;
  status: string;
  message_id: number | null;
  attempts: number;
  scheduled_at: Date;
}

interface ContextRow extends RowDataPacket {
  case_id: number;
  case_status: string;
  appointment_id: number;
  organization_id: number;
  status: string;
  appointment_date: string;
  appointment_time: string;
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

async function findOpenCase(
  db: Pool,
  appointmentId: number,
  organizationId: number | undefined,
): Promise<CaseRow | null> {
  const orgFilter = organizationId === undefined ? '' : ' AND organization_id = ?';
  const params: number[] =
    organizationId === undefined ? [appointmentId] : [appointmentId, organizationId];
  const [rows] = await db.query<CaseRow[]>(
    `SELECT id, organization_id, appointment_id FROM no_show_cases
     WHERE appointment_id = ? AND status = 'OPEN'${orgFilter}`,
    params,
  );
  return rows[0] ?? null;
}

async function loadContext(db: Pool, caseId: number): Promise<ContextRow | null> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT c.id AS case_id, c.status AS case_status,
       a.id AS appointment_id, a.organization_id, a.status,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
       a.appointment_time, o.name AS org_name,
       p.id AS patient_id, p.phone, p.first_name, p.sms_opt_out
     FROM no_show_cases c
     JOIN appointments a ON a.id = c.appointment_id
     JOIN organizations o ON o.id = a.organization_id
     JOIN patients p ON p.id = a.patient_id
     WHERE c.id = ?`,
    [caseId],
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

export interface StartResult {
  started: boolean;
  caseId: number | null;
  reason?: 'disabled' | 'appointment_not_no_show' | 'already_started';
}

export interface StartInput {
  appointmentId: number;
  now?: Date;
}

export async function startNoShowRecovery(
  db: Pool,
  logger: Logger,
  input: StartInput,
): Promise<StartResult> {
  const now = input.now ?? new Date();
  const appointmentId = input.appointmentId;

  const cfg = await loadNoShowConfig(db);
  if (!cfg.enabled) {
    return { started: false, caseId: null, reason: 'disabled' };
  }

  const ctx = await loadContextByAppointment(db, appointmentId);
  if (ctx === null || ctx.status !== 'NO_SHOW') {
    return { started: false, caseId: null, reason: 'appointment_not_no_show' };
  }

  let caseId: number;
  try {
    const [result] = await db.query(
      `INSERT IGNORE INTO no_show_cases (organization_id, appointment_id, patient_id, opened_at)
       VALUES (?, ?, ?, ?)`,
      [ctx.organization_id, appointmentId, ctx.patient_id, now],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const existing = await findOpenCase(db, appointmentId, undefined);
      if (existing === null) {
        const [closedRows] = await db.query<CaseRow[]>(
          'SELECT id, organization_id, appointment_id FROM no_show_cases WHERE appointment_id = ?',
          [appointmentId],
        );
        const closed = closedRows[0];
        if (closed !== undefined) {
          return { started: false, caseId: closed.id, reason: 'already_started' };
        }
        return { started: false, caseId: null, reason: 'already_started' };
      }
      return { started: false, caseId: existing.id, reason: 'already_started' };
    }
    caseId = (result as { insertId: number }).insertId;
  } catch (err) {
    if (isDuplicate(err)) {
      const existing = await findOpenCase(db, appointmentId, undefined);
      return { started: false, caseId: existing?.id ?? null, reason: 'already_started' };
    }
    throw err;
  }

  const followUpAt = new Date(now.getTime() + cfg.followUpDelayHours * HOUR_MS);
  try {
    await db.query(
      `INSERT IGNORE INTO no_show_messages (case_id, organization_id, phase, scheduled_at)
       VALUES (?, ?, 'INITIAL', ?)`,
      [caseId, ctx.organization_id, now],
    );
    await db.query(
      `INSERT IGNORE INTO no_show_messages (case_id, organization_id, phase, scheduled_at)
       VALUES (?, ?, 'FOLLOW_UP', ?)`,
      [caseId, ctx.organization_id, followUpAt],
    );
  } catch (err) {
    await db.query('DELETE FROM no_show_cases WHERE id = ? AND status = ?', [caseId, 'OPEN']);
    throw err;
  }

  const [initialRows] = await db.query<NoShowMessageRow[]>(
    `SELECT id, case_id, organization_id, phase, status, message_id, attempts, scheduled_at
     FROM no_show_messages WHERE case_id = ? AND phase = 'INITIAL'`,
    [caseId],
  );
  const initial = initialRows[0];
  if (initial !== undefined) {
    const result = emptyResult();
    await processNoShowMessage(db, logger, cfg, initial, now, result);
    if (result.sent > 0 || result.suppressed > 0 || result.failed > 0) {
      logger.info('no-show initial message processed', { caseId, ...result });
    }
  }

  logger.info('no-show recovery started', {
    caseId,
    appointmentId,
    followUpAt: followUpAt.toISOString(),
  });
  return { started: true, caseId };
}

async function loadContextByAppointment(db: Pool, appointmentId: number): Promise<ContextRow | null> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT a.id AS appointment_id, a.organization_id, a.status,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
       a.appointment_time, o.name AS org_name,
       p.id AS patient_id, p.phone, p.first_name, p.sms_opt_out
     FROM appointments a
     JOIN organizations o ON o.id = a.organization_id
     JOIN patients p ON p.id = a.patient_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  return rows[0] ?? null;
}

export interface CloseInput {
  appointmentId: number;
  organizationId?: number;
  reason: string;
  rebookedAppointmentId?: number | null;
}

export interface CloseResult {
  closed: boolean;
  caseId: number | null;
  status: 'OPEN' | 'REBOOKED' | 'CLOSED' | null;
}

export async function closeNoShowCase(
  db: Pool,
  logger: Logger,
  input: CloseInput,
): Promise<CloseResult> {
  const existing = await findOpenCase(db, input.appointmentId, input.organizationId);
  if (existing === null) {
    return { closed: false, caseId: null, status: null };
  }

  const reason = input.reason.slice(0, 64);
  const newStatus = input.reason === 'rebooked' ? 'REBOOKED' : 'CLOSED';
  const now = new Date();
  const [result] = await db.query(
    `UPDATE no_show_cases
     SET status = ?, close_reason = ?, closed_at = ?,
         rebooked_appointment_id = COALESCE(?, rebooked_appointment_id)
     WHERE id = ? AND status = 'OPEN'`,
    [newStatus, reason, now, input.rebookedAppointmentId ?? null, existing.id],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    return { closed: false, caseId: existing.id, status: null };
  }

  const [cancel] = await db.query(
    `UPDATE no_show_messages
     SET status = 'CANCELLED', suppression_reason = ?
     WHERE case_id = ? AND status IN ('PENDING', 'FAILED', 'SENDING')`,
    [reason, existing.id],
  );
  const cancelled = (cancel as { affectedRows: number }).affectedRows;
  logger.info('no-show case closed', {
    caseId: existing.id,
    appointmentId: input.appointmentId,
    reason,
    status: newStatus,
    cancelledMessages: cancelled,
  });
  return { closed: true, caseId: existing.id, status: newStatus };
}

export interface NoShowTickResult {
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  cancelled: number;
  rebooked: number;
}

function emptyResult(): NoShowTickResult {
  return {
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    cancelled: 0,
    rebooked: 0,
  };
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
  messageId: number,
  fields: FinalizeFields,
): Promise<boolean> {
  const [result] = await db.query(
    `UPDATE no_show_messages
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
      messageId,
    ],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

function backoffFrom(now: Date, attempts: number): Date {
  return new Date(now.getTime() + 60_000 * 2 ** Math.max(0, attempts - 1));
}

async function processNoShowMessage(
  db: Pool,
  logger: Logger,
  cfg: NoShowConfig,
  row: NoShowMessageRow,
  now: Date,
  result: NoShowTickResult,
): Promise<void> {
  const claimedAttempts = row.attempts + 1;
  const [claim] = await db.query(
    `UPDATE no_show_messages
     SET status = 'SENDING', attempts = ?
     WHERE id = ? AND status = ? AND attempts = ?`,
    [claimedAttempts, row.id, row.status, row.attempts],
  );
  if ((claim as { affectedRows: number }).affectedRows === 0) {
    return;
  }
  result.processed += 1;

  try {
    const ctx = await loadContext(db, row.case_id);
    if (ctx === null) {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'case_inactive',
        })
      ) {
        result.cancelled += 1;
      }
      return;
    }
    if (ctx.case_status !== 'OPEN') {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'case_closed',
        })
      ) {
        result.cancelled += 1;
      }
      return;
    }
    if (ctx.status !== 'NO_SHOW') {
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

    const provider = getProvider(cfg.provider);
    const isInitial = row.phase === 'INITIAL';
    const template = isInitial ? cfg.templates.initial : cfg.templates.followUp;
    const templateName = isInitial ? 'no_show_message' : 'no_show_follow_up';
    const appointmentTime = ctx.appointment_time.slice(0, 5);
    let finalMessageId: number | null = row.message_id;
    let outcome: string;

    if (row.message_id === null) {
      const sent = await sendTemplateMessage(db, logger, provider, {
        organizationId: row.organization_id,
        channel: cfg.channel,
        to: ctx.phone,
        templateText: template,
        templateName,
        variables: {
          first_name: ctx.first_name,
          clinic_name: ctx.org_name,
          appointment_date: ctx.appointment_date,
          appointment_time: appointmentTime,
        },
        idempotencyKey: `noshow:${row.id}`,
        messageType: templateName,
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
      logger.info('no-show message sent', {
        messageId: row.id,
        caseId: row.case_id,
        phase: row.phase,
        providerMessageId: finalMessageId,
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
      logger.warn('no-show message send failed', {
        messageId: row.id,
        caseId: row.case_id,
        phase: row.phase,
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
    logger.error('no-show message processing error', {
      messageId: row.id,
      caseId: row.case_id,
      error: text,
    });
  }
}

export interface NoShowTickOptions {
  now?: Date;
  batchSize?: number;
}

export async function runNoShowTick(
  db: Pool,
  logger: Logger,
  options: NoShowTickOptions = {},
): Promise<NoShowTickResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const result = emptyResult();

  const cfg = await loadNoShowConfig(db);
  if (!cfg.enabled) {
    return result;
  }

  await db.query(
    `UPDATE no_show_messages
     SET status = 'FAILED', last_error = COALESCE(last_error, 'interrupted'),
         scheduled_at = ?
     WHERE status = 'SENDING' AND updated_at < DATE_SUB(?, INTERVAL 600 SECOND)`,
    [now, now],
  );

  const today = now.toISOString().slice(0, 10);
  const [openCases] = await db.query<OpenCaseRow[]>(
    `SELECT c.id, c.organization_id, c.appointment_id, c.patient_id,
       (SELECT r.id FROM appointments r
        WHERE r.organization_id = c.organization_id AND r.patient_id = c.patient_id
          AND r.status IN ('SCHEDULED', 'CONFIRMED')
          AND r.appointment_date >= ?
        ORDER BY r.appointment_date ASC, r.id ASC
        LIMIT 1) AS rebooked_id
     FROM no_show_cases c
     WHERE c.status = 'OPEN'
     LIMIT ?`,
    [today, batchSize],
  );
  for (const openCase of openCases) {
    if (openCase.rebooked_id === null) {
      continue;
    }
    const closed = await closeNoShowCase(db, logger, {
      appointmentId: openCase.appointment_id,
      organizationId: openCase.organization_id,
      reason: 'rebooked',
      rebookedAppointmentId: openCase.rebooked_id,
    });
    if (closed.closed) {
      result.rebooked += 1;
    }
  }

  const [due] = await db.query<NoShowMessageRow[]>(
    `SELECT m.id, m.case_id, m.organization_id, m.phase, m.status, m.message_id,
       m.attempts, m.scheduled_at
     FROM no_show_messages m
     JOIN no_show_cases c ON c.id = m.case_id
     WHERE c.status = 'OPEN'
       AND (m.status = 'PENDING' OR (m.status = 'FAILED' AND m.attempts < ?))
       AND m.scheduled_at <= ?
     ORDER BY m.scheduled_at ASC, m.id ASC
     LIMIT ?`,
    [cfg.maxAttempts, now, batchSize],
  );
  for (const row of due) {
    await processNoShowMessage(db, logger, cfg, row, now, result);
  }

  if (result.processed > 0 || result.rebooked > 0) {
    logger.info('no-show tick finished', { ...result });
  }
  return result;
}
