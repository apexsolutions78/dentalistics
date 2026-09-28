import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getProvider } from '../communications/registry';
import { DEFAULT_MISSED_CALL_TEMPLATE, MISSED_CALL_TEMPLATE_NAME } from '../communications/template';
import type { Logger } from '../logger';
import { sendTemplateMessage, sendMessage } from '../services/messages';

export const MISSED_CALL_CONFIG_META_KEY = 'missed_call_config';

export interface MissedCallConfig {
  enabled: boolean;
  channel: 'SMS' | 'WHATSAPP';
  provider: string;
  template: string;
}

export const DEFAULT_MISSED_CALL_CONFIG: MissedCallConfig = {
  enabled: true,
  channel: 'SMS',
  provider: 'mock',
  template: DEFAULT_MISSED_CALL_TEMPLATE,
};

function isMissedCallConfig(value: unknown): value is MissedCallConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const cfg = value as Record<string, unknown>;
  return (
    typeof cfg.enabled === 'boolean' &&
    (cfg.channel === 'SMS' || cfg.channel === 'WHATSAPP') &&
    typeof cfg.provider === 'string' &&
    cfg.provider.length > 0 &&
    typeof cfg.template === 'string' &&
    cfg.template.length > 0
  );
}

export async function loadMissedCallConfig(db: Pool): Promise<MissedCallConfig> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT meta_value FROM app_meta WHERE meta_key = ?',
    [MISSED_CALL_CONFIG_META_KEY],
  );
  const raw = rows[0]?.meta_value;
  if (typeof raw !== 'string' || raw === '') {
    return { ...DEFAULT_MISSED_CALL_CONFIG };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isMissedCallConfig(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_MISSED_CALL_CONFIG };
}

export function missedCallIdempotencyKey(providerKey: string, eventId: string): string {
  return `missedcall:${providerKey}:${eventId}`;
}

export interface MissedCallResponseInput {
  organizationId: number;
  providerKey: string;
  eventId: string;
  to: string;
  firstName: string;
  clinicName: string;
  leadId: number | null;
}

export interface MissedCallResponseResult {
  action: 'sent' | 'failed' | 'skipped_disabled' | 'duplicate' | 'not_found' | 'error';
  messageId?: number;
}

export async function sendMissedCallResponse(
  db: Pool,
  logger: Logger,
  input: MissedCallResponseInput,
): Promise<MissedCallResponseResult> {
  try {
    const config = await loadMissedCallConfig(db);
    if (!config.enabled) {
      logger.info('missed-call response skipped', { ...input, reason: 'disabled' });
      return { action: 'skipped_disabled' };
    }
    const result = await sendTemplateMessage(db, logger, getProvider(config.provider), {
      organizationId: input.organizationId,
      channel: config.channel,
      to: input.to,
      templateName: MISSED_CALL_TEMPLATE_NAME,
      templateText: config.template,
      variables: {
        first_name: input.firstName,
        clinic_name: input.clinicName,
      },
      idempotencyKey: missedCallIdempotencyKey(input.providerKey, input.eventId),
      leadId: input.leadId,
      messageType: MISSED_CALL_TEMPLATE_NAME,
    });
    if (!result.created) {
      logger.info('missed-call response duplicate skipped', { eventId: input.eventId });
      return { action: 'duplicate', messageId: result.message.id as number };
    }
    const messageId = result.message.id as number;
    const action = result.outcome === 'sent' ? 'sent' : 'failed';
    logger.info('missed-call response result', { eventId: input.eventId, messageId, action });
    return { action, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('missed-call response failed', { eventId: input.eventId, error: message });
    return { action: 'error' };
  }
}

export interface RetryMissedCallInput {
  organizationId: number;
  providerKey: string;
  eventId: string;
}

export async function retryMissedCallResponse(
  db: Pool,
  logger: Logger,
  input: RetryMissedCallInput,
): Promise<MissedCallResponseResult> {
  try {
    const idempotencyKey = missedCallIdempotencyKey(input.providerKey, input.eventId);
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT id, status FROM communication_messages
       WHERE organization_id = ? AND idempotency_key = ?
       ORDER BY id DESC LIMIT 1`,
      [input.organizationId, idempotencyKey],
    );
    const existing = rows[0] as { id: number; status: string } | undefined;
    if (existing === undefined) {
      return { action: 'not_found' };
    }
    if (existing.status !== 'FAILED' && existing.status !== 'PENDING') {
      return { action: 'duplicate', messageId: existing.id };
    }
    const config = await loadMissedCallConfig(db);
    const sent = await sendMessage(db, logger, getProvider(config.provider), input.organizationId, existing.id);
    const action = sent.outcome === 'sent' ? 'sent' : 'failed';
    logger.info('missed-call response retry result', {
      eventId: input.eventId,
      messageId: existing.id,
      action,
    });
    return { action, messageId: existing.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('missed-call response retry failed', { eventId: input.eventId, error: message });
    return { action: 'error' };
  }
}
