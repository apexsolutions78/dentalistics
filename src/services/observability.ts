import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { getProvider } from '../communications/registry';
import { requireChoice, parseListParams } from '../validate';
import { sendMessage } from './messages';

export const AUTOMATION_LOG_KINDS: readonly string[] = ['reminder', 'no_show', 'recall', 'review'];
export const FAILED_JOB_KINDS: readonly string[] = [...AUTOMATION_LOG_KINDS, 'message'];
export const JOB_STATUSES: readonly string[] = [
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'SUPPRESSED',
  'CANCELLED',
];
export const WEBHOOK_SOURCES: readonly string[] = ['telephony', 'whatsapp'];

interface JobTable {
  kind: string;
  table: string;
  subject: string;
}

const JOB_TABLES: readonly JobTable[] = [
  { kind: 'reminder', table: 'appointment_reminders', subject: 'appointment_id' },
  { kind: 'no_show', table: 'no_show_messages', subject: 'case_id' },
  { kind: 'recall', table: 'recall_messages', subject: 'recall_id' },
  { kind: 'review', table: 'review_requests', subject: 'appointment_id' },
];

function jobTableFor(kind: string): JobTable {
  const found = JOB_TABLES.find((entry) => entry.kind === kind);
  if (found === undefined) {
    throw new AppError('Unknown job kind', 400, 'validation_failed', true);
  }
  return found;
}

function jobSelect(entry: JobTable): string {
  return (
    `SELECT '${entry.kind}' AS kind, id, status, attempts, last_error, ` +
    `suppression_reason, scheduled_at, sent_at, message_id, ` +
    `${entry.subject} AS subject_id, created_at, updated_at FROM ${entry.table}`
  );
}

export interface ListInput {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listAutomationLogs(
  db: Pool,
  input: ListInput,
): Promise<{ logs: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);
  const status =
    input.query.status !== undefined
      ? requireChoice(input.query.status, JOB_STATUSES, 'status')
      : null;
  const kind =
    input.query.kind !== undefined
      ? requireChoice(input.query.kind, AUTOMATION_LOG_KINDS, 'kind')
      : null;
  let subjectId: number | null = null;
  if (input.query.subjectId !== undefined) {
    subjectId = Number(input.query.subjectId);
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      throw new ValidationError('Invalid input', ['subjectId must be a positive integer']);
    }
  }
  const tables = JOB_TABLES.filter((entry) => kind === null || entry.kind === kind);

  const branches: string[] = [];
  const params: unknown[] = [];
  for (const entry of tables) {
    const where = ['organization_id = ?'];
    const branchParams: unknown[] = [input.organizationId];
    if (status !== null) {
      where.push('status = ?');
      branchParams.push(status);
    }
    if (subjectId !== null) {
      where.push(`${entry.subject} = ?`);
      branchParams.push(subjectId);
    }
    branches.push(`${jobSelect(entry)} WHERE ${where.join(' AND ')}`);
    params.push(...branchParams);
  }
  const union = branches.join(' UNION ALL ');

  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${union}) AS job_union`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM (${union}) AS job_union ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { logs: rows, total, limit, offset };
}

export async function listFailedJobs(
  db: Pool,
  input: ListInput,
): Promise<{ jobs: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);
  const branches: string[] = [];
  const params: unknown[] = [];
  for (const entry of JOB_TABLES) {
    branches.push(
      `SELECT '${entry.kind}' AS kind, id, status, attempts, last_error AS error, message_id, updated_at ` +
        `FROM ${entry.table} WHERE organization_id = ? AND status = 'FAILED'`,
    );
    params.push(input.organizationId);
  }
  branches.push(
    `SELECT 'message' AS kind, id, status, attempts, provider_error AS error, id AS message_id, updated_at ` +
      `FROM communication_messages WHERE organization_id = ? AND status = 'FAILED'`,
  );
  params.push(input.organizationId);
  const union = branches.join(' UNION ALL ');

  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${union}) AS failed_union`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT * FROM (${union}) AS failed_union ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { jobs: rows, total, limit, offset };
}

export interface RetryResult {
  kind: string;
  id: number;
  action: 'requeued' | 'sent';
  status: string;
}

export async function retryFailedJob(
  db: Pool,
  logger: Logger,
  organizationId: number,
  kind: string,
  id: number,
): Promise<RetryResult> {
  requireChoice(kind, FAILED_JOB_KINDS, 'kind');

  if (kind === 'message') {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, status, provider_key FROM communication_messages
       WHERE id = ? AND organization_id = ?`,
      [id, organizationId],
    );
    const row = rows[0] as { id: number; status: string; provider_key: string | null } | undefined;
    if (row === undefined) {
      throw new AppError('Message not found', 404, 'not_found', true);
    }
    if (row.status !== 'FAILED') {
      throw new AppError('Message is not failed', 409, 'not_failed', true);
    }
    if (row.provider_key === null || row.provider_key === '') {
      throw new AppError('Message has no provider to retry with', 409, 'no_provider', true);
    }
    const [update] = await db.query(
      `UPDATE communication_messages SET status = 'PENDING'
       WHERE id = ? AND organization_id = ? AND status = 'FAILED'`,
      [id, organizationId],
    );
    if ((update as { affectedRows: number }).affectedRows === 0) {
      throw new AppError('Message is not failed', 409, 'not_failed', true);
    }
    let provider;
    try {
      provider = getProvider(row.provider_key);
    } catch {
      throw new AppError('Message provider is not registered', 409, 'unknown_provider', true);
    }
    const result = await sendMessage(db, logger, provider, organizationId, id);
    if (result.outcome === 'failed') {
      throw new AppError('Retry failed', 500, 'retry_failed', false);
    }
    return { kind, id, action: 'sent', status: 'SENT' };
  }

  const table = jobTableFor(kind);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, status FROM ${table.table} WHERE id = ? AND organization_id = ?`,
    [id, organizationId],
  );
  const row = rows[0] as { id: number; status: string } | undefined;
  if (row === undefined) {
    throw new AppError('Job not found', 404, 'not_found', true);
  }
  if (row.status !== 'FAILED') {
    throw new AppError('Job is not failed', 409, 'not_failed', true);
  }
    const [update] = await db.query(
      `UPDATE ${table.table}
       SET status = 'PENDING', scheduled_at = UTC_TIMESTAMP(), last_error = NULL
       WHERE id = ? AND organization_id = ? AND status = 'FAILED'`,
      [id, organizationId],
    );
    if ((update as { affectedRows: number }).affectedRows === 0) {
      throw new AppError('Job is not failed', 409, 'not_failed', true);
    }
    logger.info('failed job requeued', { kind, jobId: id, organizationId });
  return { kind, id, action: 'requeued', status: 'PENDING' };
}

export async function listWebhookEvents(
  db: Pool,
  input: ListInput,
): Promise<{ events: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);
  const where = ['organization_id = ?'];
  const params: unknown[] = [input.organizationId];
  if (input.query.source !== undefined) {
    where.push('source = ?');
    params.push(requireChoice(input.query.source, WEBHOOK_SOURCES, 'source'));
  }
  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM webhook_events WHERE ${whereSql}`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, source, request_method, http_status, outcome, provider_key, detail, created_at
     FROM webhook_events WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { events: rows, total, limit, offset };
}

export async function listErrorEvents(
  db: Pool,
  organizationId: number | null,
  query: Record<string, unknown>,
): Promise<{ events: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(query);
  const where = organizationId === null ? ['1 = 1'] : ['organization_id = ?'];
  const params: unknown[] = organizationId === null ? [] : [organizationId];
  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM error_events WHERE ${whereSql}`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, scope, request_method, request_path, http_status, error_code, error_name,
            error_message, created_at
     FROM error_events WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { events: rows, total, limit, offset };
}

export async function listAuditLogs(
  db: Pool,
  organizationId: number | null,
  query: Record<string, unknown>,
): Promise<{ logs: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(query);
  const where = organizationId === null ? ['1 = 1'] : ['organization_id = ?'];
  const params: unknown[] = organizationId === null ? [] : [organizationId];
  if (query.action !== undefined) {
    where.push('action = ?');
    params.push(String(query.action).slice(0, 64));
  }
  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM audit_logs WHERE ${whereSql}`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, organization_id, user_id, action, detail, created_at
     FROM audit_logs WHERE ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { logs: rows, total, limit, offset };
}

export interface WebhookEventInput {
  organizationId: number | null;
  source: 'telephony' | 'whatsapp';
  requestMethod: string;
  httpStatus: number;
  outcome: string;
  providerKey?: string | null;
  remoteIp?: string | null;
  detail?: string | null;
}

export async function recordWebhookEvent(
  db: Pool,
  logger: Logger,
  input: WebhookEventInput,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO webhook_events
         (organization_id, source, request_method, http_status, outcome, provider_key, remote_ip, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId,
        input.source,
        input.requestMethod.slice(0, 8),
        input.httpStatus,
        input.outcome.slice(0, 64),
        input.providerKey ?? null,
        input.remoteIp ?? null,
        input.detail === undefined || input.detail === null ? null : input.detail.slice(0, 255),
      ],
    );
  } catch (err) {
    logger.error('webhook event write failed', {
      source: input.source,
      outcome: input.outcome,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ErrorEventInput {
  organizationId: number | null;
  method: string;
  path: string;
  statusCode: number;
  code: string;
  errorName: string | null;
  errorMessage: string | null;
}

export async function recordErrorEvent(
  db: Pool,
  logger: Logger,
  input: ErrorEventInput,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO error_events
         (organization_id, scope, request_method, request_path, http_status, error_code, error_name, error_message)
       VALUES (?, 'request', ?, ?, ?, ?, ?, ?)`,
      [
        input.organizationId,
        input.method.slice(0, 8),
        input.path.slice(0, 500),
        input.statusCode,
        input.code.slice(0, 64),
        input.errorName === null ? null : input.errorName.slice(0, 100),
        input.errorMessage === null ? null : input.errorMessage.slice(0, 1000),
      ],
    );
  } catch (err) {
    logger.error('error event write failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface QueueCountRow extends RowDataPacket {
  status: string;
  total: number;
}

async function statusCounts(
  db: Pool,
  table: string,
  organizationId: number,
): Promise<Record<string, number>> {
  const [rows] = await db.query<QueueCountRow[]>(
    `SELECT status, COUNT(*) AS total FROM ${table} WHERE organization_id = ? GROUP BY status`,
    [organizationId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = Number(row.total);
  }
  return counts;
}

async function recentCount(
  db: Pool,
  table: string,
  organizationId: number,
): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM ${table}
     WHERE organization_id = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY`,
    [organizationId],
  );
  return Number((rows[0] as { total: number }).total);
}

export async function getDiagnostics(
  db: Pool,
  organizationId: number,
  scheduler: {
    intervalMs: number | null;
    ticks: Record<string, { lastStartedAt: string | null; lastSuccessAt: string | null; lastErrorAt: string | null; lastError: string | null }>;
  },
): Promise<Record<string, unknown>> {
  let database: 'up' | 'down';
  try {
    await db.query('SELECT 1');
    database = 'up';
  } catch {
    database = 'down';
  }

  const [reminders, noShows, recalls, reviews, messages] = await Promise.all([
    statusCounts(db, 'appointment_reminders', organizationId),
    statusCounts(db, 'no_show_messages', organizationId),
    statusCounts(db, 'recall_messages', organizationId),
    statusCounts(db, 'review_requests', organizationId),
    statusCounts(db, 'communication_messages', organizationId),
  ]);
  const [webhookRecent, errorRecent] = await Promise.all([
    recentCount(db, 'webhook_events', organizationId),
    recentCount(db, 'error_events', organizationId),
  ]);

  return {
    server: {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    },
    database,
    queues: {
      reminders: {
        pending: reminders.PENDING ?? 0,
        sending: reminders.SENDING ?? 0,
        failed: reminders.FAILED ?? 0,
      },
      noShow: {
        pending: noShows.PENDING ?? 0,
        sending: noShows.SENDING ?? 0,
        failed: noShows.FAILED ?? 0,
      },
      recalls: {
        pending: recalls.PENDING ?? 0,
        sending: recalls.SENDING ?? 0,
        failed: recalls.FAILED ?? 0,
      },
      reviews: {
        pending: reviews.PENDING ?? 0,
        sending: reviews.SENDING ?? 0,
        failed: reviews.FAILED ?? 0,
      },
      messages: {
        pending: messages.PENDING ?? 0,
        failed: messages.FAILED ?? 0,
        undelivered: messages.UNDELIVERED ?? 0,
      },
    },
    recent: {
      webhookEvents: webhookRecent,
      errorEvents: errorRecent,
    },
    scheduler: {
      intervalMs: scheduler.intervalMs,
      ticks: scheduler.ticks,
    },
  };
}
