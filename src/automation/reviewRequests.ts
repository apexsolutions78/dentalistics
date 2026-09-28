import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Logger } from '../logger';
import { getProvider } from '../communications/registry';
import { sendTemplateMessage, sendMessage } from '../services/messages';
import type { ReviewConfig } from './reviewConfig';
import { loadReviewConfig } from './reviewConfig';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface ReviewRow extends RowDataPacket {
  id: number;
  status: string;
}

interface ReviewWorkRow extends RowDataPacket {
  id: number;
  organization_id: number;
  status: string;
  message_id: number | null;
  attempts: number;
}

interface AppointmentCtxRow extends RowDataPacket {
  appointment_id: number;
  organization_id: number;
  patient_id: number;
  status: string;
  org_review_url: string | null;
}

interface ReviewContextRow extends RowDataPacket {
  review_id: number;
  review_status: string;
  organization_id: number;
  patient_id: number;
  review_url: string | null;
  org_name: string;
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

async function findRequestForAppointment(
  db: Pool,
  appointmentId: number,
): Promise<ReviewRow | null> {
  const [rows] = await db.query<ReviewRow[]>(
    'SELECT id, status FROM review_requests WHERE appointment_id = ?',
    [appointmentId],
  );
  return rows[0] ?? null;
}

async function findRecentRequestForPatient(
  db: Pool,
  organizationId: number,
  patientId: number,
  cutoff: Date,
): Promise<ReviewRow | null> {
  const [rows] = await db.query<ReviewRow[]>(
    `SELECT id, status FROM review_requests
     WHERE organization_id = ? AND patient_id = ?
       AND status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')
       AND created_at >= ?
     ORDER BY id ASC LIMIT 1`,
    [organizationId, patientId, cutoff],
  );
  return rows[0] ?? null;
}

async function loadAppointmentCtx(
  db: Pool,
  appointmentId: number,
): Promise<AppointmentCtxRow | null> {
  const [rows] = await db.query<AppointmentCtxRow[]>(
    `SELECT a.id AS appointment_id, a.organization_id, a.patient_id, a.status,
       o.review_url AS org_review_url
     FROM appointments a
     JOIN organizations o ON o.id = a.organization_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  return rows[0] ?? null;
}

async function loadContext(db: Pool, reviewId: number): Promise<ReviewContextRow | null> {
  const [rows] = await db.query<ReviewContextRow[]>(
    `SELECT r.id AS review_id, r.status AS review_status, r.organization_id, r.patient_id,
       r.review_url, o.name AS org_name, p.phone, p.first_name, p.sms_opt_out
     FROM review_requests r
     JOIN organizations o ON o.id = r.organization_id
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = ?`,
    [reviewId],
  );
  return rows[0] ?? null;
}

async function loadWorkRow(db: Pool, reviewId: number): Promise<ReviewWorkRow | null> {
  const [rows] = await db.query<ReviewWorkRow[]>(
    'SELECT id, organization_id, status, message_id, attempts FROM review_requests WHERE id = ?',
    [reviewId],
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

export interface CreateReviewRequestResult {
  created: boolean;
  reviewRequestId: number | null;
  status: 'PENDING' | 'SUPPRESSED' | null;
  reason?: 'disabled' | 'appointment_not_completed' | 'already_exists' | 'review_url_missing';
}

export interface CreateReviewRequestInput {
  appointmentId: number;
  now?: Date;
}

export async function createReviewRequestForCompletedAppointment(
  db: Pool,
  logger: Logger,
  input: CreateReviewRequestInput,
): Promise<CreateReviewRequestResult> {
  const now = input.now ?? new Date();
  const appointmentId = input.appointmentId;

  const cfg = await loadReviewConfig(db);
  if (!cfg.enabled) {
    return { created: false, reviewRequestId: null, status: null, reason: 'disabled' };
  }

  const ctx = await loadAppointmentCtx(db, appointmentId);
  if (ctx === null || ctx.status !== 'COMPLETED') {
    return {
      created: false,
      reviewRequestId: null,
      status: null,
      reason: 'appointment_not_completed',
    };
  }

  const existing = await findRequestForAppointment(db, appointmentId);
  if (existing !== null) {
    return {
      created: false,
      reviewRequestId: existing.id,
      status: null,
      reason: 'already_exists',
    };
  }

  const reviewUrl =
    typeof ctx.org_review_url === 'string' && ctx.org_review_url.trim() !== ''
      ? ctx.org_review_url.trim()
      : null;
  if (reviewUrl === null) {
    return { created: false, reviewRequestId: null, status: null, reason: 'review_url_missing' };
  }

  const scheduledAt = new Date(now.getTime() + cfg.delayHours * HOUR_MS);
  const cutoff = new Date(now.getTime() - cfg.suppressionPeriodDays * DAY_MS);
  const recent = await findRecentRequestForPatient(db, ctx.organization_id, ctx.patient_id, cutoff);
  const suppressed = recent !== null;

  let reviewId: number;
  try {
    const [result] = await db.query(
      `INSERT INTO review_requests
         (organization_id, patient_id, appointment_id, status, scheduled_at,
          suppression_reason, review_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.organization_id,
        ctx.patient_id,
        appointmentId,
        suppressed ? 'SUPPRESSED' : 'PENDING',
        scheduledAt,
        suppressed ? 'within_suppression_period' : null,
        reviewUrl,
      ],
    );
    reviewId = (result as { insertId: number }).insertId;
  } catch (err) {
    if (isDuplicate(err)) {
      const again = await findRequestForAppointment(db, appointmentId);
      return {
        created: false,
        reviewRequestId: again?.id ?? null,
        status: null,
        reason: 'already_exists',
      };
    }
    throw err;
  }

  if (suppressed) {
    logger.info('review request suppressed', {
      reviewId,
      appointmentId,
      reason: 'within_suppression_period',
      priorRequestId: recent?.id ?? null,
    });
    return { created: true, reviewRequestId: reviewId, status: 'SUPPRESSED' };
  }

  if (scheduledAt.getTime() <= now.getTime()) {
    const work = await loadWorkRow(db, reviewId);
    if (work !== null) {
      const result = emptyResult();
      await processReviewRequest(db, logger, cfg, work, now, result);
      if (result.sent > 0 || result.suppressed > 0 || result.failed > 0) {
        logger.info('review request processed immediately', { reviewId, ...result });
      }
    }
  }

  logger.info('review request created', {
    reviewId,
    appointmentId,
    scheduledAt: scheduledAt.toISOString(),
  });
  return { created: true, reviewRequestId: reviewId, status: 'PENDING' };
}

export interface ReviewTickResult {
  processed: number;
  sent: number;
  failed: number;
  suppressed: number;
  cancelled: number;
}

function emptyResult(): ReviewTickResult {
  return { processed: 0, sent: 0, failed: 0, suppressed: 0, cancelled: 0 };
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
  rowId: number,
  fields: FinalizeFields,
): Promise<boolean> {
  const [result] = await db.query(
    `UPDATE review_requests
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
      rowId,
    ],
  );
  return (result as { affectedRows: number }).affectedRows > 0;
}

function backoffFrom(now: Date, attempts: number): Date {
  return new Date(now.getTime() + 60_000 * 2 ** Math.max(0, attempts - 1));
}

async function processReviewRequest(
  db: Pool,
  logger: Logger,
  cfg: ReviewConfig,
  row: ReviewWorkRow,
  now: Date,
  result: ReviewTickResult,
): Promise<void> {
  const claimedAttempts = row.attempts + 1;
  const [claim] = await db.query(
    `UPDATE review_requests
     SET status = 'SENDING', attempts = ?
     WHERE id = ? AND status = ? AND attempts = ?`,
    [claimedAttempts, row.id, row.status, row.attempts],
  );
  if ((claim as { affectedRows: number }).affectedRows === 0) {
    return;
  }
  result.processed += 1;

  try {
    const ctx = await loadContext(db, row.id);
    if (ctx === null) {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'review_request_inactive',
        })
      ) {
        result.cancelled += 1;
      }
      return;
    }
    if (ctx.review_status !== 'SENDING') {
      if (
        await finalizeSending(db, row.id, {
          status: 'CANCELLED',
          suppressionReason: 'review_request_closed',
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
    const reviewUrl =
      typeof ctx.review_url === 'string' && ctx.review_url.trim() !== ''
        ? ctx.review_url.trim()
        : null;
    if (reviewUrl === null) {
      if (
        await finalizeSending(db, row.id, {
          status: 'SUPPRESSED',
          suppressionReason: 'review_url_missing',
        })
      ) {
        result.suppressed += 1;
      }
      return;
    }

    const provider = getProvider(cfg.provider);
    let finalMessageId: number | null = row.message_id;
    let outcome: string;

    if (row.message_id === null) {
      const sent = await sendTemplateMessage(db, logger, provider, {
        organizationId: ctx.organization_id,
        channel: cfg.channel,
        to: ctx.phone,
        templateText: cfg.template,
        templateName: 'review_request',
        variables: {
          first_name: ctx.first_name,
          clinic_name: ctx.org_name,
          review_url: reviewUrl,
        },
        idempotencyKey: `review:${row.id}`,
        messageType: 'review_request',
      });
      finalMessageId = (sent.message.id as number) ?? null;
      outcome = sent.outcome;
    } else {
      const sent = await sendMessage(
        db,
        logger,
        provider,
        ctx.organization_id,
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
        logger.info('review request sent', {
          reviewId: row.id,
          messageId: finalMessageId,
        });
      }
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
      logger.warn('review request send failed', {
        reviewId: row.id,
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
    logger.error('review request processing error', {
      reviewId: row.id,
      error: text,
    });
  }
}

export interface ReviewTickOptions {
  now?: Date;
  batchSize?: number;
}

export async function runReviewRequestTick(
  db: Pool,
  logger: Logger,
  options: ReviewTickOptions = {},
): Promise<ReviewTickResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 100;
  const result = emptyResult();

  const cfg = await loadReviewConfig(db);
  if (!cfg.enabled) {
    return result;
  }

  await db.query(
    `UPDATE review_requests
     SET status = 'FAILED', last_error = COALESCE(last_error, 'interrupted'),
         scheduled_at = ?
     WHERE status = 'SENDING' AND updated_at < DATE_SUB(?, INTERVAL 600 SECOND)`,
    [now, now],
  );

  const [due] = await db.query<ReviewWorkRow[]>(
    `SELECT id, organization_id, status, message_id, attempts
     FROM review_requests
     WHERE (status = 'PENDING' OR (status = 'FAILED' AND attempts < ?))
       AND scheduled_at <= ?
     ORDER BY scheduled_at ASC, id ASC
     LIMIT ?`,
    [cfg.maxAttempts, now, batchSize],
  );
  for (const row of due) {
    await processReviewRequest(db, logger, cfg, row, now, result);
  }

  if (result.processed > 0) {
    logger.info('review request tick finished', { ...result });
  }
  return result;
}
