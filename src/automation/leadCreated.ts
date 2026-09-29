import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getProvider } from '../communications/registry';
import { LEAD_ACK_TEMPLATE_NAME } from '../communications/template';
import type { Logger } from '../logger';
import { sendTemplateMessage, sendMessage } from '../services/messages';
import { loadAckConfig } from './config';

export interface LeadCreatedEvent {
  organizationId: number;
  leadId: number;
}

export type LeadAutomationAction =
  | 'ack_sent'
  | 'ack_failed'
  | 'ack_duplicate'
  | 'skipped_disabled'
  | 'skipped_source'
  | 'skipped_missing_lead'
  | 'error';

export interface LeadAutomationResult {
  action: LeadAutomationAction;
  messageId?: number;
}

interface LeadAckRow extends RowDataPacket {
  id: number;
  first_name: string;
  phone: string;
  source: string;
}

interface OrgNameRow extends RowDataPacket {
  id: number;
  name: string;
  phone: string | null;
}

interface AckStatusRow extends RowDataPacket {
  id: number;
  status: string;
}

const ACK_IDEMPOTENCY_PREFIX = 'ack:lead:';

export function ackIdempotencyKey(leadId: number): string {
  return `${ACK_IDEMPOTENCY_PREFIX}${leadId}`;
}

export async function triggerLeadCreated(
  db: Pool,
  logger: Logger,
  event: LeadCreatedEvent,
): Promise<LeadAutomationResult> {
  try {
    const [leadRows] = await db.query<LeadAckRow[]>(
      'SELECT id, first_name, phone, source FROM leads WHERE id = ? AND organization_id = ?',
      [event.leadId, event.organizationId],
    );
    const lead = leadRows[0];
    if (lead === undefined) {
      logger.error('lead automation skipped', { ...event, reason: 'lead_not_found' });
      return { action: 'skipped_missing_lead' };
    }

    logger.info('automation trigger: lead_created', {
      organizationId: event.organizationId,
      leadId: event.leadId,
      source: lead.source,
    });

    const config = await loadAckConfig(db, event.organizationId);
    if (!config.enabled) {
      logger.info('lead automation skipped', { ...event, reason: 'disabled' });
      return { action: 'skipped_disabled' };
    }
    if (!config.sources.includes(lead.source)) {
      logger.info('lead automation skipped', { ...event, reason: 'source_not_configured' });
      return { action: 'skipped_source' };
    }

    const [orgRows] = await db.query<OrgNameRow[]>(
      'SELECT id, name, phone FROM organizations WHERE id = ?',
      [event.organizationId],
    );
    const org = orgRows[0];
    if (org === undefined) {
      logger.error('lead automation skipped', { ...event, reason: 'org_not_found' });
      return { action: 'skipped_missing_lead' };
    }

    const result = await sendTemplateMessage(db, logger, getProvider(config.provider), {
      organizationId: event.organizationId,
      channel: config.channel,
      to: lead.phone,
      templateName: LEAD_ACK_TEMPLATE_NAME,
      templateText: config.template,
      variables: {
        first_name: lead.first_name,
        clinic_name: org.name,
        clinic_phone: org.phone ?? '',
      },
      idempotencyKey: ackIdempotencyKey(event.leadId),
      leadId: event.leadId,
      messageType: LEAD_ACK_TEMPLATE_NAME,
    });

    if (!result.created) {
      logger.info('lead acknowledgement duplicate skipped', { ...event });
      return { action: 'ack_duplicate', messageId: result.message.id as number };
    }

    const messageId = result.message.id as number;
    const action = result.outcome === 'sent' ? 'ack_sent' : 'ack_failed';
    logger.info('lead acknowledgement result', {
      ...event,
      messageId,
      action,
      status: result.message.status,
    });
    return { action, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('lead automation failed', { ...event, error: message });
    return { action: 'error' };
  }
}

export async function retryLeadAcknowledgement(
  db: Pool,
  logger: Logger,
  event: LeadCreatedEvent,
): Promise<LeadAutomationResult> {
  try {
    const [rows] = await db.query<AckStatusRow[]>(
      `SELECT id, status FROM communication_messages
       WHERE organization_id = ? AND lead_id = ? AND message_type = ?
       ORDER BY id DESC LIMIT 1`,
      [event.organizationId, event.leadId, LEAD_ACK_TEMPLATE_NAME],
    );
    const existing = rows[0];
    if (existing === undefined) {
      return { action: 'skipped_missing_lead' };
    }
    if (existing.status !== 'FAILED' && existing.status !== 'PENDING') {
      return { action: 'ack_duplicate', messageId: existing.id };
    }

    const config = await loadAckConfig(db, event.organizationId);
    const sent = await sendMessage(db, logger, getProvider(config.provider), event.organizationId, existing.id);
    const action = sent.outcome === 'sent' ? 'ack_sent' : 'ack_failed';
    logger.info('lead acknowledgement retry result', {
      ...event,
      messageId: existing.id,
      action,
      status: sent.message.status,
    });
    return { action, messageId: existing.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('lead acknowledgement retry failed', { ...event, error: message });
    return { action: 'error' };
  }
}
