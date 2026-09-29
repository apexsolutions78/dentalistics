import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { getProvider } from '../communications/registry';
import { sendTemplateMessage, sendMessage } from '../services/messages';
import type { RecallConfig } from './recallConfig';
import { RECALL_CONFIG_META_KEY, loadRecallConfig } from './recallConfig';
import { loadOrgEnabledFilter } from '../db/orgMeta';

const HOUR_MS = 3_600_000;

const OPEN_STATUSES = "('DUE', 'CONTACTED')";

interface RecallRow extends RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  status: string;
}

interface AppointmentCtxRow extends RowDataPacket {
  appointment_id: number;
  organization_id: number;
  patient_id: number;
  status: string;
  appointment_date: string;
}

interface RecallMessageRow extends RowDataPacket {
  id: number;
  recall_id: number;
  organization_id: number;
  phase: string;
  status: string;
  message_id: number | null;
  attempts: number;
  scheduled_at: Date;
}

interface ContextRow extends RowDataPacket {
  recall_id: number;
  recall_status: string;
  organization_id: number;
  patient_id: number;
  due_date: string;
  recall_type: string;
  org_name: string;
  clinic_phone: string | null;
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

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function findOpenRecall(
  db: Pool,
  organizationId: number,
  patientId: number,
): Promise<RecallRow | null> {
  const [rows] = await db.query<RecallRow[]>(
    `SELECT id, organization_id, patient_id, status FROM recalls
     WHERE organization_id = ? AND patient_id = ? AND status IN ${OPEN_STATUSES}
     ORDER BY id ASC LIMIT 1`,
    [organizationId, patientId],
  );
  return rows[0] ?? null;
}

async function loadAppointmentCtx(
  db: Pool,
  appointmentId: number,
): Promise<AppointmentCtxRow | null> {
  const [rows] = await db.query<AppointmentCtxRow[]>(
    `SELECT a.id AS appointment_id, a.organization_id, a.patient_id, a.status,
       DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date
     FROM appointments a WHERE a.id = ?`,
    [appointmentId],
  );
  return rows[0] ?? null;
}

async function loadContext(db: Pool, recallId: number): Promise<ContextRow | null> {
  const [rows] = await db.query<ContextRow[]>(
    `SELECT r.id AS recall_id, r.status AS recall_status, r.organization_id, r.patient_id,
       DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due_date, r.recall_type, o.name AS org_name,
       o.phone AS clinic_phone,
       p.phone, p.first_name, p.sms_opt_out
     FROM recalls r
     JOIN organizations o ON o.id = r.organization_id
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = ?`,
    [recallId],
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

export interface CreateRecallResult {
  created: boolean;
  recallId: number | null;
  dueDate: string | null;
  reason?: 'disabled' | 'appointment_not_completed' | 'already_exists';
}

export interface CreateRecallInput {
  appointmentId: number;
  now?: Date;
}

export async function createRecallForCompletedAppointment(
  db: Pool,
  logger: Logger,
  input: CreateRecallInput,
): Promise<CreateRecallResult> {
  const now = input.now ?? new Date();
  const appointmentId = input.appointmentId;

  const ctx = await loadAppointmentCtx(db, appointmentId);
  if (ctx === null) {
    return { created: false, recallId: null, dueDate: null, reason: 'appointment_not_completed' };
  }

  const cfg = await loadRecallConfig(db, ctx.organization_id);
  if (!cfg.enabled) {
    return { created: false, recallId: null, dueDate: null, reason: 'disabled' };
  }

  if (ctx.status !== 'COMPLETED') {
    return { created: false, recallId: null, dueDate: null, reason: 'appointment_not_completed' };
  }

  const existing = await findOpenRecall(db, ctx.organization_id, ctx.patient_id);
  if (existing !== null) {
    return { created: false, recallId: existing.id, dueDate: null, reason: 'already_exists' };
  }

  const dueDate = addDays(ctx.appointment_date, cfg.intervalDays);
  let recallId: number;
  try {
    const [result] = await db.query(
      `INSERT IGNORE INTO recalls
         (organization_id, patient_id, recall_type, due_date, anchor_appointment_id, opened_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ctx.organization_id, ctx.patient_id, 'hygiene', dueDate, appointmentId, now],
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [byAnchor] = await db.query<RecallRow[]>(
        `SELECT id, organization_id, patient_id, status FROM recalls WHERE anchor_appointment_id = ?`,
        [appointmentId],
      );
      return {
        created: false,
        recallId: byAnchor[0]?.id ?? null,
        dueDate: null,
        reason: 'already_exists',
      };
    }
    recallId = (result as { insertId: number }).insertId;
  } catch (err) {
    if (isDuplicate(err)) {
      const open = await findOpenRecall(db, ctx.organization_id, ctx.patient_id);
      return { created: false, recallId: open?.id ?? null, dueDate: null, reason: 'already_exists' };
    }
    throw err;
  }

  const dueAt = new Date(`${dueDate}T00:00:00.000Z`);
  const followUpAt = new Date(dueAt.getTime() + cfg.followUpDelayHours * HOUR_MS);
  try {
    await db.query(
      `INSERT IGNORE INTO recall_messages (recall_id, organization_id, phase, scheduled_at)
       VALUES (?, ?, 'INITIAL', ?)`,
      [recallId, ctx.organization_id, dueAt],
    );
    await db.query(
      `INSERT IGNORE INTO recall_messages (recall_id, organization_id, phase, scheduled_at)
       VALUES (?, ?, 'FOLLOW_UP', ?)`,
      [recallId, ctx.organization_id, followUpAt],
    );
  } catch (err) {
    await db.query('DELETE FROM recalls WHERE id = ? AND status = ?', [recallId, 'DUE']);
    throw err;
  }

  if (dueAt.getTime() <= now.getTime()) {
    const [initialRows] = await db.query<RecallMessageRow[]>(
      `SELECT id, recall_id, organization_id, phase, status, message_id, attempts, scheduled_at
       FROM recall_messages WHERE recall_id = ? AND phase = 'INITIAL'`,
      [recallId],
    );
    const initial = initialRows[0];
    if (initial !== undefined) {
      const result = emptyResult();
      await processRecallMessage(db, logger, cfg, initial, now, result);
      if (result.sent > 0 || result.suppressed > 0 || result.failed > 0) {
        logger.info('recall initial message processed', { recallId, ...result });
      }
    }
  }

  logger.info('recall created', {
    recallId,
    appointmentId,
    dueDate,
    dueAt: dueAt.toISOString(),
  });
  return { created: true, recallId, dueDate };
}

export interface CloseRecallInput {
  recallId: number;
  organizationId?: number;
  reason: string;
  rebookedAppointmentId?: number | null;
}

export interface CloseRecallResult {
  closed: boolean;
  recallId: number | null;
  status: 'DUE' | 'CONTACTED' | 'BOOKED' | 'COMPLETED' | 'CLOSED' | null;
}

function statusForReason(reason: string): 'BOOKED' | 'COMPLETED' | 'CLOSED' {
  if (reason === 'booked' || reason === 'rebooked') {
    return 'BOOKED';
  }
  if (reason === 'visit_completed' || reason === 'completed') {
    return 'COMPLETED';
  }
  return 'CLOSED';
}

export async function closeRecall(
  db: Pool,
  logger: Logger,
  input: CloseRecallInput,
): Promise<CloseRecallResult> {
  const orgFilter = input.organizationId === undefined ? '' : ' AND organization_id = ?';
  const params: number[] =
    input.organizationId === undefined
      ? [input.recallId]
      : [input.recallId, input.organizationId];
  const [rows] = await db.query<RecallRow[]>(
    `SELECT id, organization_id, patient_id, status FROM recalls
     WHERE id = ?${orgFilter}`,
    params,
  );
  const existing = rows[0];
  if (existing === undefined || (existing.status !== 'DUE' && existing.status !== 'CONTACTED')) {
    return { closed: false, recallId: existing?.id ?? null, status: null };
  }

  const reason = input.reason.slice(0, 64);
  const newStatus = statusForReason(reason);
  const now = new Date();
  const [result] = await db.query(
    `UPDATE recalls
     SET status = ?, close_reason = ?, closed_at = ?,
         rebooked_appointment_id = COALESCE(?, rebooked_appointment_id)
     WHERE id = ? AND status IN ${OPEN_STATUSES}`,
    [newStatus, reason, now, input.rebookedAppointmentId ?? null, existing.id],
  );
  if ((result as { affectedRows: number }).affectedRows === 0) {
    return { closed: false, recallId: existing.id, status: null };
  }

  const [cancel] = await db.query(
    `UPDATE recall_messages
     SET status = 'CANCELLED', suppression_reason = ?
     WHERE recall_id = ? AND status IN ('PENDING', 'FAILED', 'SENDING')`,
    [reason, existing.id],
  );
  const cancelled = (cancel as { affectedRows: number }).affectedRows;
  logger.info('recall closed', {
    recallId: existing.id,
    reason,
    status: newStatus,
    cancelledMessages: cancelled,
  });
  return { closed: true, recallId: existing.id, status: newStatus };
}

export interface BookingCloseResult {
  closed: boolean;
  recallId: number | null;
  reason?: 'appointment_not_active' | 'no_open_recall';
}

export async function closeRecallsForPatientOnBooking(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<BookingCloseResult> {
  if (appointmentId === 0) {
    return { closed: false, recallId: null, reason: 'no_open_recall' };
  }
  const ctx = await loadAppointmentCtx(db, appointmentId);
  if (ctx === null || (ctx.status !== 'SCHEDULED' && ctx.status !== 'CONFIRMED')) {
    return { closed: false, recallId: null, reason: 'appointment_not_active' };
  }
  const open = await findOpenRecall(db, ctx.organization_id, ctx.patient_id);
  if (open === null) {
    return { closed: false, recallId: null, reason: 'no_open_recall' };
  }
  const closed = await closeRecall(db, logger, {
    recallId: open.id,
    organizationId: ctx.organization_id,
    reason: 'booked',
    rebookedAppointmentId: appointmentId,
  });
  return { closed: closed.closed, recallId: closed.recallId };
}

export interface VisitCompletedResult {
  flipped: boolean;
  closed: boolean;
}

export async function closeRecallOnVisitCompleted(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<VisitCompletedResult> {
  if (appointmentId === 0) {
    return { flipped: false, closed: false };
  }
  const now = new Date();
  const [flip] = await db.query(
    `UPDATE recalls
     SET status = 'COMPLETED', close_reason = 'visit_completed', closed_at = ?
     WHERE rebooked_appointment_id = ? AND status = 'BOOKED'`,
    [now, appointmentId],
  );
  const flipped = (flip as { affectedRows: number }).affectedRows > 0;

  const ctx = await loadAppointmentCtx(db, appointmentId);
  if (ctx === null) {
    return { flipped, closed: false };
  }
  const open = await findOpenRecall(db, ctx.organization_id, ctx.patient_id);
  if (open === null) {
    return { flipped, closed: false };
  }
  const result = await closeRecall(db, logger, {
    recallId: open.id,
    organizationId: ctx.organization_id,
    reason: 'visit_completed',
    rebookedAppointmentId: null,
  });
  if (flipped || result.closed) {
    logger.info('recall closed on visit completion', {
      appointmentId,
      flipped,
      closed: result.closed,
    });
  }
  return { flipped, closed: result.closed };
}

export interface RecallTickResult {
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  cancelled: number;
  booked: number;
}

function emptyResult(): RecallTickResult {
  return {
    processed: 0,
    sent: 0,
    failed: 0,
    suppressed: 0,
    cancelled: 0,
    booked: 0,
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
    `UPDATE recall_messages
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

async function markContacted(
  db: Pool,
  recallId: number,
  now: Date,
  phase: string,
): Promise<void> {
  await db.query(
    `UPDATE recalls SET last_contacted_at = ?
     WHERE id = ? AND status IN ${OPEN_STATUSES}`,
    [now, recallId],
  );
  if (phase === 'INITIAL') {
    await db.query(
      `UPDATE recalls SET status = 'CONTACTED' WHERE id = ? AND status = 'DUE'`,
      [recallId],
    );
  }
}

async function processRecallMessage(
  db: Pool,
  logger: Logger,
  cfg: RecallConfig,
  row: RecallMessageRow,
  now: Date,
  result: RecallTickResult,
): Promise<void> {
  const claimedAttempts = row.attempts + 1;
  const [claim] = await db.query(
    `UPDATE recall_messages
     SET status = 'SENDING', attempts = ?
     WHERE id = ? AND status = ? AND attempts = ?`,
    [claimedAttempts, row.id, row.status, row.attempts],
  );
  if ((claim as { affectedRows: number }).affectedRows === 0) {
    return;
  }
  result.processed += 1;

  try {
    const ctx = await loadContext(db, row.recall_id);
    if (ctx === null) {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'recall_inactive',
        })
      ) {
        result.cancelled += 1;
      }
      return;
    }
    if (ctx.recall_status !== 'DUE' && ctx.recall_status !== 'CONTACTED') {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'recall_closed',
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
    const template = isInitial ? cfg.templates.recall : cfg.templates.followUp;
    const templateName = isInitial ? 'recall_message' : 'recall_follow_up';
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
          clinic_phone: ctx.clinic_phone ?? '',
          due_date: ctx.due_date,
          interval_days: String(cfg.intervalDays),
          recall_type: ctx.recall_type,
        },
        idempotencyKey: `recall:${row.id}`,
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
        await markContacted(db, row.recall_id, now, row.phase);
      }
      logger.info('recall message sent', {
        messageId: row.id,
        recallId: row.recall_id,
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
      logger.warn('recall message send failed', {
        messageId: row.id,
        recallId: row.recall_id,
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
        await markContacted(db, row.recall_id, now, row.phase);
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
    logger.error('recall message processing error', {
      messageId: row.id,
      recallId: row.recall_id,
      error: text,
    });
  }
}

export interface RecallTickOptions {
  now?: Date;
  batchSize?: number;
}

export async function runRecallTick(
  db: Pool,
  logger: Logger,
  options: RecallTickOptions = {},
): Promise<RecallTickResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const result = emptyResult();

  const cfg = await loadRecallConfig(db);
  const filter = await loadOrgEnabledFilter(
    db,
    RECALL_CONFIG_META_KEY,
    cfg.enabled,
    'r.organization_id',
  );
  if (!filter.eligible) {
    return result;
  }

  await db.query(
    `UPDATE recall_messages
     SET status = 'FAILED', last_error = COALESCE(last_error, 'interrupted'),
         scheduled_at = ?
     WHERE status = 'SENDING' AND updated_at < DATE_SUB(?, INTERVAL 600 SECOND)`,
    [now, now],
  );

  const today = now.toISOString().slice(0, 10);
  const [openRows] = await db.query<(RecallRow & { booking_id: number | null })[]>(
    `SELECT r.id, r.organization_id, r.patient_id, r.status,
       (SELECT a.id FROM appointments a
        WHERE a.organization_id = r.organization_id AND a.patient_id = r.patient_id
          AND a.status IN ('SCHEDULED', 'CONFIRMED')
          AND a.appointment_date >= ?
        ORDER BY a.appointment_date ASC, a.id ASC
        LIMIT 1) AS booking_id
     FROM recalls r
     WHERE r.status IN ${OPEN_STATUSES}${filter.clause}
     LIMIT ?`,
    [today, batchSize, ...filter.params],
  );
  for (const openRow of openRows) {
    if (openRow.booking_id === null) {
      continue;
    }
    const closed = await closeRecall(db, logger, {
      recallId: openRow.id,
      organizationId: openRow.organization_id,
      reason: 'booked',
      rebookedAppointmentId: openRow.booking_id,
    });
    if (closed.closed) {
      result.booked += 1;
    }
  }

  const [due] = await db.query<RecallMessageRow[]>(
    `SELECT m.id, m.recall_id, m.organization_id, m.phase, m.status, m.message_id,
       m.attempts, m.scheduled_at
     FROM recall_messages m
     JOIN recalls r ON r.id = m.recall_id
     WHERE r.status IN ${OPEN_STATUSES}
       AND (m.status = 'PENDING' OR (m.status = 'FAILED' AND m.attempts < ?))
       AND m.scheduled_at <= ?${filter.clause}
     ORDER BY m.scheduled_at ASC, m.id ASC
     LIMIT ?`,
    [cfg.maxAttempts, now, batchSize, ...filter.params],
  );
  const orgCfgCache = new Map<number, RecallConfig>();
  for (const row of due) {
    let orgCfg = orgCfgCache.get(row.organization_id);
    if (orgCfg === undefined) {
      orgCfg = await loadRecallConfig(db, row.organization_id);
      orgCfgCache.set(row.organization_id, orgCfg);
    }
    if (!orgCfg.enabled) {
      continue;
    }
    await processRecallMessage(db, logger, orgCfg, row, now, result);
  }

  if (result.processed > 0 || result.booked > 0) {
    logger.info('recall tick finished', { ...result });
  }
  return result;
}
