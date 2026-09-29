import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import type { RateLimiter } from '../security/rateLimit';
import { ingestCallEvent } from '../services/callEvents';
import { recordWebhookEvent } from '../services/observability';
import { loadTelephonyConfig } from '../telephony/config';
import { getTelephonyAdapter } from '../telephony/registry';
import { parsePathId } from '../validate';

export interface WebhookRouterDeps {
  db: Pool;
  logger: Logger;
  ipLimiter: RateLimiter;
}

interface OrgRow extends RowDataPacket {
  id: number;
  status: string;
}

function flatParams(body: unknown): Record<string, string> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      params[key] = String(value);
    }
  }
  return params;
}

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  router.post('/telephony/:provider/:orgId', async (req: Request, res: Response) => {
    if (!deps.ipLimiter.check(`telephony-webhook|ip|${req.ip ?? 'unknown'}`)) {
      deps.logger.warn('telephony webhook rate limited', { scope: 'ip' });
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'telephony',
        requestMethod: req.method,
        httpStatus: 429,
        outcome: 'rate_limited',
        providerKey: String(req.params.provider ?? '').slice(0, 64) || null,
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Too many webhook requests, try again later', 429, 'rate_limited', true);
    }

    const rawProvider = req.params.provider;
    const providerKey = Array.isArray(rawProvider) ? (rawProvider[0] ?? '') : (rawProvider ?? '');
    const adapter = getTelephonyAdapter(providerKey);
    if (adapter === null) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: null,
        source: 'telephony',
        requestMethod: req.method,
        httpStatus: 404,
        outcome: 'unknown_provider',
        providerKey: providerKey.slice(0, 64) || null,
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Unknown telephony provider', 404, 'unknown_provider', true);
    }

    const organizationId = parsePathId(req.params.orgId);
    const [orgs] = await deps.db.query<OrgRow[]>(
      'SELECT id, status FROM organizations WHERE id = ?',
      [organizationId],
    );
    const org = orgs[0];
    if (org === undefined || org.status !== 'active') {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId: org === undefined ? null : organizationId,
        source: 'telephony',
        requestMethod: req.method,
        httpStatus: 404,
        outcome: org === undefined ? 'org_not_found' : 'org_inactive',
        providerKey: adapter.key,
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Organization not found', 404, 'not_found', true);
    }

    const config = await loadTelephonyConfig(deps.db, organizationId);
    if (!config.enabled) {
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'telephony',
        requestMethod: req.method,
        httpStatus: 403,
        outcome: 'disabled',
        providerKey: adapter.key,
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Telephony webhooks are disabled', 403, 'telephony_disabled', true);
    }

    const fullUrl = `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`;
    const params = flatParams(req.body);
    const signature = req.header(adapter.signatureHeader);
    const valid =
      config.signingSecret !== '' &&
      adapter.verifySignature({ fullUrl, params }, config.signingSecret, signature);
    if (!valid) {
      deps.logger.warn('telephony webhook signature rejected', {
        provider: adapter.key,
        organizationId,
      });
      await recordWebhookEvent(deps.db, deps.logger, {
        organizationId,
        source: 'telephony',
        requestMethod: req.method,
        httpStatus: 401,
        outcome: 'invalid_signature',
        providerKey: adapter.key,
        remoteIp: req.ip ?? null,
      });
      throw new AppError('Invalid webhook signature', 401, 'invalid_signature', true);
    }

    const event = adapter.parse(req.body);
    const rawPayload = JSON.stringify(req.body ?? {}).slice(0, 20000);
    const result = await ingestCallEvent(deps.db, deps.logger, {
      organizationId,
      providerKey: adapter.key,
      event,
      rawPayload,
    });

    await recordWebhookEvent(deps.db, deps.logger, {
      organizationId,
      source: 'telephony',
      requestMethod: req.method,
      httpStatus: 200,
      outcome: result.duplicate ? 'duplicate' : 'processed',
      providerKey: adapter.key,
      remoteIp: req.ip ?? null,
      detail: `status=${result.status} disposition=${result.disposition}`,
    });

    res.status(200).json({
      status: result.duplicate ? 'duplicate' : result.status.toLowerCase(),
      callEventId: result.callEventId,
      disposition: result.disposition,
      leadId: result.leadId,
      patientId: result.patientId,
      messageId: result.messageId,
    });
  });

  return router;
}
