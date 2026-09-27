import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  CommunicationProvider,
  MessageChannel,
  MessageDirection,
  MessageStatus,
} from '../communications/types';
import { ProviderSendError } from '../communications/types';
import { renderTemplate } from '../communications/template';
import { AppError, ValidationError } from '../errors';
import type { Logger } from '../logger';
import { ACTIVE_STATUSES } from './leads';
import {
  normalizePhone,
  optionalText,
  optionalUserId,
  parseListParams,
  requireChoice,
  requireString,
} from '../validate';

export const MESSAGE_CHANNELS: readonly string[] = ['SMS', 'WHATSAPP'];

export const MESSAGE_STATUSES: readonly string[] = [
  'PENDING',
  'SENT',
  'FAILED',
  'DELIVERED',
  'UNDELIVERED',
  'RECEIVED',
];

export const MESSAGE_DIRECTIONS: readonly string[] = ['OUTBOUND', 'INBOUND'];

const DELIVERY_STATUSES: readonly string[] = ['DELIVERED', 'UNDELIVERED'];

const DISPATCHABLE: readonly string[] = ['PENDING', 'FAILED'];

interface MessageRow extends RowDataPacket {
  id: number;
  organization_id: number;
  channel: MessageChannel;
  recipient: string;
  body: string;
  status: MessageStatus;
  direction: MessageDirection;
  message_type: string | null;
  template: string | null;
  lead_id: number | null;
  provider_key: string | null;
  provider_message_id: string | null;
  provider_error: string | null;
  idempotency_key: string;
  attempts: number;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function messageDto(row: MessageRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    channel: row.channel,
    recipient: row.recipient,
    body: row.body,
    status: row.status,
    direction: row.direction,
    messageType: row.message_type,
    template: row.template,
    leadId: row.lead_id,
    providerKey: row.provider_key,
    providerMessageId: row.provider_message_id,
    providerError: row.provider_error,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertOrgExists(db: Pool, organizationId: number): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id FROM organizations WHERE id = ?',
    [organizationId],
  );
  if (rows[0] === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
}

async function loadMessage(
  db: Pool,
  organizationId: number,
  messageId: number,
): Promise<MessageRow | null> {
  const [rows] = await db.query<MessageRow[]>(
    'SELECT * FROM communication_messages WHERE id = ? AND organization_id = ?',
    [messageId, organizationId],
  );
  return rows[0] ?? null;
}

export interface CreateMessageInput {
  organizationId: number;
  channel: unknown;
  to: unknown;
  body: unknown;
  idempotencyKey: unknown;
  direction?: unknown;
  messageType?: unknown;
  template?: unknown;
  leadId?: unknown;
  status?: unknown;
}

export async function createMessage(
  db: Pool,
  logger: Logger,
  input: CreateMessageInput,
): Promise<{ message: Record<string, unknown>; created: boolean }> {
  const channel = requireChoice(input.channel, MESSAGE_CHANNELS, 'channel');
  const recipient = normalizePhone(input.to, 'to');
  const body = requireString(input.body, 'body', { min: 1, max: 4096 });
  const idempotencyKey = requireString(input.idempotencyKey, 'idempotencyKey', {
    min: 1,
    max: 128,
  });
  const direction =
    input.direction === undefined
      ? 'OUTBOUND'
      : requireChoice(input.direction, MESSAGE_DIRECTIONS, 'direction');
  const messageType = optionalText(input.messageType, 'messageType', 64);
  const template = optionalText(input.template, 'template', 64);
  const status =
    input.status === undefined ? null : requireChoice(input.status, MESSAGE_STATUSES, 'status');
  const leadId = optionalUserId(input.leadId, 'leadId');
  if (leadId !== null) {
    const [leadRows] = await db.query<RowDataPacket[]>(
      'SELECT id FROM leads WHERE id = ? AND organization_id = ?',
      [leadId, input.organizationId],
    );
    if (leadRows[0] === undefined) {
      throw new ValidationError('Invalid input', ['leadId must belong to this clinic']);
    }
  }

  await assertOrgExists(db, input.organizationId);

  let messageId: number;
  try {
    const insertColumns = [
      'organization_id',
      'channel',
      'recipient',
      'body',
      'idempotency_key',
      'direction',
      'message_type',
      'template',
      'lead_id',
    ];
    const insertValues: unknown[] = [
      input.organizationId,
      channel,
      recipient,
      body,
      idempotencyKey,
      direction,
      messageType,
      template,
      leadId,
    ];
    if (status !== null) {
      insertColumns.push('status');
      insertValues.push(status);
    }
    const placeholders = insertColumns.map(() => '?').join(', ');
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO communication_messages (${insertColumns.join(', ')}) VALUES (${placeholders})`,
      insertValues,
    );
    messageId = result.insertId;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      const existing = await db.query<MessageRow[]>(
        'SELECT * FROM communication_messages WHERE organization_id = ? AND idempotency_key = ?',
        [input.organizationId, idempotencyKey],
      );
      const row = (existing[0] as MessageRow[])[0];
      if (row !== undefined) {
        logger.info('message duplicate ignored', {
          messageId: row.id,
          idempotencyKey,
        });
        return { message: messageDto(row), created: false };
      }
    }
    throw err;
  }

  logger.info('message created', {
    messageId,
    organizationId: input.organizationId,
    channel,
    messageType,
  });
  const row = await loadMessage(db, input.organizationId, messageId);
  return { message: messageDto(row as MessageRow), created: true };
}

export type SendOutcome = 'sent' | 'failed' | 'skipped';

export interface SendTemplateInput {
  organizationId: number;
  channel: unknown;
  to: unknown;
  templateName: unknown;
  templateText: unknown;
  variables: Record<string, string | null | undefined>;
  idempotencyKey: unknown;
  leadId?: number | null;
  messageType?: unknown;
}

export async function sendTemplateMessage(
  db: Pool,
  logger: Logger,
  provider: CommunicationProvider,
  input: SendTemplateInput,
): Promise<{ message: Record<string, unknown>; created: boolean; outcome: SendOutcome | 'duplicate' }> {
  const templateName = requireString(input.templateName, 'templateName', { min: 1, max: 64 });
  const templateText = requireString(input.templateText, 'templateText', { min: 1, max: 4096 });
  const rendered = renderTemplate(templateText, input.variables);

  const created = await createMessage(db, logger, {
    organizationId: input.organizationId,
    channel: input.channel,
    to: input.to,
    body: rendered,
    idempotencyKey: input.idempotencyKey,
    direction: 'OUTBOUND',
    messageType: input.messageType,
    template: templateName,
    leadId: input.leadId ?? null,
  });
  if (!created.created) {
    return { message: created.message, created: false, outcome: 'duplicate' };
  }
  const messageId = created.message.id as number;
  const sent = await sendMessage(db, logger, provider, input.organizationId, messageId);
  return { message: sent.message, created: true, outcome: sent.outcome };
}

export interface HandleInboundInput {
  organizationId: number;
  channel: unknown;
  from: unknown;
  body: unknown;
  idempotencyKey: unknown;
  leadId?: unknown;
}

export async function handleInboundMessage(
  db: Pool,
  logger: Logger,
  input: HandleInboundInput,
): Promise<{ message: Record<string, unknown>; created: boolean }> {
  const from = normalizePhone(input.from, 'from');
  const explicitLeadId = input.leadId === undefined ? null : optionalUserId(input.leadId, 'leadId');

  let leadId = explicitLeadId;
  if (leadId === null) {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(', ');
    const [leadRows] = await db.query<RowDataPacket[]>(
      `SELECT id FROM leads
       WHERE organization_id = ? AND phone = ? AND status IN (${placeholders})
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [input.organizationId, from, ...ACTIVE_STATUSES],
    );
    leadId = (leadRows[0]?.id as number | undefined) ?? null;
  }

  return createMessage(db, logger, {
    organizationId: input.organizationId,
    channel: input.channel,
    to: from,
    body: input.body,
    idempotencyKey: input.idempotencyKey,
    direction: 'INBOUND',
    messageType: 'patient_reply',
    leadId,
    status: 'RECEIVED',
  });
}

export async function sendMessage(
  db: Pool,
  logger: Logger,
  provider: CommunicationProvider,
  organizationId: number,
  messageId: number,
): Promise<{ message: Record<string, unknown>; outcome: SendOutcome }> {
  const existing = await loadMessage(db, organizationId, messageId);
  if (existing === null) {
    throw new AppError('Message not found', 404, 'not_found', true);
  }

  if (!DISPATCHABLE.includes(existing.status)) {
    logger.info('message send skipped', {
      messageId,
      status: existing.status,
    });
    return { message: messageDto(existing), outcome: 'skipped' };
  }

  const attempts = existing.attempts + 1;
  try {
    const result = await provider.send({
      messageId,
      organizationId,
      channel: existing.channel,
      to: existing.recipient,
      body: existing.body,
    });
    await db.query(
      `UPDATE communication_messages
       SET status = 'SENT', provider_key = ?, provider_message_id = ?, provider_error = NULL,
           attempts = ?, sent_at = UTC_TIMESTAMP()
       WHERE id = ? AND organization_id = ?`,
      [provider.key, result.providerMessageId, attempts, messageId, organizationId],
    );
    logger.info('message sent', {
      messageId,
      provider: provider.key,
      providerMessageId: result.providerMessageId,
      attempts,
    });
  } catch (err) {
    const code = err instanceof ProviderSendError ? err.code : 'provider_error';
    const text = err instanceof Error ? err.message : String(err);
    const stored = `${code}: ${text}`.slice(0, 1000);
    await db.query(
      `UPDATE communication_messages
       SET status = 'FAILED', provider_key = ?, provider_error = ?, attempts = ?
       WHERE id = ? AND organization_id = ?`,
      [provider.key, stored, attempts, messageId, organizationId],
    );
    logger.error('message failed', { messageId, provider: provider.key, code, attempts });
  }

  const updated = await loadMessage(db, organizationId, messageId);
  const row = updated as MessageRow;
  const outcome: SendOutcome = row.status === 'SENT' ? 'sent' : 'failed';
  return { message: messageDto(row), outcome };
}

export interface ApplyStatusInput {
  organizationId: number;
  messageId: number;
  status: unknown;
}

export async function applyProviderStatus(
  db: Pool,
  logger: Logger,
  input: ApplyStatusInput,
): Promise<Record<string, unknown>> {
  const status = requireChoice(input.status, DELIVERY_STATUSES, 'status');
  const existing = await loadMessage(db, input.organizationId, input.messageId);
  if (existing === null) {
    throw new AppError('Message not found', 404, 'not_found', true);
  }
  if (existing.status !== 'SENT') {
    throw new AppError(
      'Only a sent message can receive a delivery status',
      409,
      'invalid_status_transition',
      true,
    );
  }

  await db.query(
    `UPDATE communication_messages
     SET status = ?, delivered_at = ?
     WHERE id = ? AND organization_id = ?`,
    [status, status === 'DELIVERED' ? new Date() : null, input.messageId, input.organizationId],
  );
  logger.info('delivery status updated', { messageId: input.messageId, status });

  const updated = await loadMessage(db, input.organizationId, input.messageId);
  return messageDto(updated as MessageRow);
}

export interface MessageListInput {
  organizationId: number;
  query: Record<string, unknown>;
}

export async function listMessages(
  db: Pool,
  input: MessageListInput,
): Promise<{ messages: Array<Record<string, unknown>>; total: number; limit: number; offset: number }> {
  const { limit, offset } = parseListParams(input.query);
  await assertOrgExists(db, input.organizationId);

  const where: string[] = ['organization_id = ?'];
  const params: unknown[] = [input.organizationId];

  if (input.query.status !== undefined) {
    where.push('status = ?');
    params.push(requireChoice(input.query.status, MESSAGE_STATUSES, 'status'));
  }
  if (input.query.channel !== undefined) {
    where.push('channel = ?');
    params.push(requireChoice(input.query.channel, MESSAGE_CHANNELS, 'channel'));
  }

  const whereSql = where.join(' AND ');
  const [countRows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM communication_messages WHERE ${whereSql}`,
    params,
  );
  const total = (countRows[0] as { total: number }).total;

  const [rows] = await db.query<MessageRow[]>(
    `SELECT * FROM communication_messages WHERE ${whereSql}
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { messages: rows.map(messageDto), total, limit, offset };
}

export async function getMessage(
  db: Pool,
  organizationId: number,
  messageId: number,
): Promise<Record<string, unknown> | null> {
  const row = await loadMessage(db, organizationId, messageId);
  return row === null ? null : messageDto(row);
}
