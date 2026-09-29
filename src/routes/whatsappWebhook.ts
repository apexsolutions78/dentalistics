import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadWhatsAppConfig } from '../communications/whatsappConfig';
import { parseWhatsAppPayload } from '../communications/whatsappPayload';
import type {
  ParsedWhatsAppPayload,
  WhatsAppStatusEvent,
} from '../communications/whatsappPayload';
import {
  WHATSAPP_SIGNATURE_HEADER,
  verifyWhatsappSignature,
} from '../communications/whatsappSignature';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import type { RateLimiter } from '../security/rateLimit';
import { applyProviderStatus, handleInboundMessage } from '../services/messages';
import { recordWebhookEvent } from '../services/observability';
import { parsePathId } from '../validate';

export interface WhatsAppWebhookRouterDeps {
  db: Pool;
  logger: Logger;
  ipLimiter: RateLimiter;
}

interface OrgRow extends RowDataPacket {
  id: number;
  status: string;
}

interface MessageStateRow extends RowDataPacket {
  id: number;
  status: string;
}

type RawBodyRequest = Request & { rawBody?: Buffer };

async function assertActiveOrg(db: Pool, organizationId: number): Promise<void> {
  const [orgs] = await db.query<OrgRow[]>(
    'SELECT id, status FROM organizations WHERE id = ?',
    [organizationId],
  );
  const org = orgs[0];
  if (org === undefined || org.status !== 'active') {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
}

async function applyStatusEvent(
  db: Pool,
  logger: Logger,
  organizationId: number,
  event: WhatsAppStatusEvent,
): Promise<'applied' | 'ignored'> {
  const target =
    event.status === 'delivered' || event.status === 'read'
      ? 'DELIVERED'
      : event.status === 'failed'
        ? 'UNDELIVERED'
        : null;
  if (target === null) {
    return 'ignored';
  }

  const [rows] = await db.query<MessageStateRow[]>(
    `SELECT id, status FROM communication_messages
     WHERE organization_id = ? AND provider_message_id = ?
     ORDER BY id DESC LIMIT 1`,
    [organizationId, event.wamid],
  );
  const row = rows[0];
  if (row === undefined || row.status !== 'SENT') {
    return 'ignored';
  }

  try {
    await applyProviderStatus(db, logger, {
      organizationId,
      messageId: row.id,
      status: target,
    });
    return 'applied';
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) {
      return 'ignored';
    }
    throw err;
  }
}

async function processInbound(
  db: Pool,
  logger: Logger,
  organizationId: number,
  parsed: ParsedWhatsAppPayload,
): Promise<{ created: number; duplicate: number; ignored: number; errors: number }> {
  let created = 0;
  let duplicate = 0;
  let ignored = 0;
  let errors = 0;

  for (const message of parsed.inbound) {
    if (message.type !== 'text' || message.textBody === null) {
      ignored += 1;
      continue;
    }
    try {
      const result = await handleInboundMessage(db, logger, {
        organizationId,
        channel: 'WHATSAPP',
        from: message.from,
        body: message.textBody,
        idempotencyKey: `whatsapp:${message.wamid}`,
      });
      if (result.created) {
        created += 1;
      } else {
        duplicate += 1;
      }
    } catch (err) {
      errors += 1;
      logger.error('whatsapp inbound processing failed', {
        organizationId,
        wamid: message.wamid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, duplicate, ignored, errors };
}

async function processStatuses(
  db: Pool,
  logger: Logger,
  organizationId: number,
  parsed: ParsedWhatsAppPayload,
): Promise<{ applied: number; ignored: number; errors: number }> {
  let applied = 0;
  let ignored = 0;
  let errors = 0;

  for (const event of parsed.statuses) {
    try {
      const result = await applyStatusEvent(db, logger, organizationId, event);
      if (result === 'applied') {
        applied += 1;
      } else {
        ignored += 1;
      }
    } catch (err) {
      errors += 1;
      logger.error('whatsapp status processing failed', {
        organizationId,
        wamid: event.wamid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { applied, ignored, errors };
}

export function createWhatsAppWebhookRouter(deps: WhatsAppWebhookRouterDeps): Router {
  const router = Router();

  router.get('/whatsapp/:orgId', async (req: Request, res: Response) => {
    if (!deps.ipLimiter.check(`whatsapp-webhook|ip|${req.ip ?? 'unknown'}`)) {
      deps.logger.warn('whatsapp webhook rate limited', { scope: 'ip' });
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 429,
        outcome: 'rate_limited',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Too many webhook requests, try again later', 429, 'rate_limited', true);
    }

    const organizationId = parsePathId(req.params.orgId);
    try {
      await assertActiveOrg(deps.db, organizationId);
    } catch (err) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 404,
        outcome: 'org_not_found',
        remoteIp: req.ip ?? null,
      });
      throw err;
    }

    const config = await loadWhatsAppConfig(deps.db, organizationId);
    const hubMode = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const verifyToken = req.query['hub.verify_token'];

    if (hubMode !== 'subscribe' || typeof challenge !== 'string' || challenge === '') {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 400,
        outcome: 'invalid_challenge',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Invalid verification challenge', 400, 'invalid_challenge', true);
    }
    if (
      config.verifyToken === '' ||
      typeof verifyToken !== 'string' ||
      verifyToken !== config.verifyToken
    ) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 403,
        outcome: 'invalid_verify_token',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Invalid verify token', 403, 'invalid_verify_token', true);
    }

    await recordWebhookEvent(deps.db, deps.logger, {
      organizationId,
      source: 'whatsapp',
      requestMethod: req.method,
      httpStatus: 200,
      outcome: 'challenge_verified',
      remoteIp: req.ip ?? null,
    });
    res.status(200).type('text/plain').send(challenge);
  });

  router.post('/whatsapp/:orgId', async (req: Request, res: Response) => {
    if (!deps.ipLimiter.check(`whatsapp-webhook|ip|${req.ip ?? 'unknown'}`)) {
      deps.logger.warn('whatsapp webhook rate limited', { scope: 'ip' });
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 429,
        outcome: 'rate_limited',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Too many webhook requests, try again later', 429, 'rate_limited', true);
    }

    const organizationId = parsePathId(req.params.orgId);
    try {
      await assertActiveOrg(deps.db, organizationId);
    } catch (err) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 404,
        outcome: 'org_not_found',
        remoteIp: req.ip ?? null,
      });
      throw err;
    }

    const config = await loadWhatsAppConfig(deps.db, organizationId);
    if (!config.enabled) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 403,
        outcome: 'disabled',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('WhatsApp webhooks are disabled', 403, 'whatsapp_disabled', true);
    }

    const rawBody = (req as RawBodyRequest).rawBody;
    const signature = req.header(WHATSAPP_SIGNATURE_HEADER);
    const valid = verifyWhatsappSignature(rawBody, signature, config.appSecret);
    if (!valid) {
      deps.logger.warn('whatsapp webhook signature rejected', { organizationId });
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 401,
        outcome: 'invalid_signature',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Invalid webhook signature', 401, 'invalid_signature', true);
    }

    const parsed = parseWhatsAppPayload(req.body);
    if (parsed === null) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'whatsapp',
        requestMethod: req.method,
        httpStatus: 400,
        outcome: 'invalid_payload',
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Invalid webhook payload', 400, 'invalid_payload', true);
    }

    const inbound = await processInbound(deps.db, deps.logger, organizationId, parsed);
    const statuses = await processStatuses(deps.db, deps.logger, organizationId, parsed);

    await recordWebhookEvent(deps.db, deps.logger, {
      organizationId,
      source: 'whatsapp',
      requestMethod: req.method,
      httpStatus: 200,
      outcome: 'processed',
      remoteIp: req.ip ?? null,
      detail: `inbound=${inbound.created + inbound.duplicate + inbound.ignored} statuses=${statuses.applied + statuses.ignored}`,
    });

    res.status(200).json({
      status: 'ok',
      inbound,
      statuses,
    });
  });

  return router;
}
