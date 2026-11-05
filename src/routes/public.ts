import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { triggerLeadCreated } from '../automation/leadCreated';
import { runLeadAutomation } from '../automation/leadAutomation';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { plansForPublic } from '../plans';
import { listRegionalPrices } from '../services/regionalPrices';
import type { RateLimiter } from '../security/rateLimit';
import { createPublicLead } from '../services/leads';
import { createDbPublicActivityReader } from '../services/publicActivity';
import type { PublicActivityReader } from '../services/publicActivity';

export interface PublicRouterDeps {
  db: Pool;
  logger: Logger;
  ipLimiter: RateLimiter;
  keyLimiter: RateLimiter;
  activityLimiter?: RateLimiter;
  activityReader?: PublicActivityReader;
  activityNow?: () => number;
  activityTtlMs?: number;
}

interface SiteKeyOrgRow extends RowDataPacket {
  id: number;
}

export function createPublicRouter(deps: PublicRouterDeps): Router {
  const router = Router();
  const activity =
    deps.activityReader ??
    createDbPublicActivityReader(deps.db, {
      now: deps.activityNow,
      ttlMs: deps.activityTtlMs,
    });
  const activityLimiter = deps.activityLimiter ?? deps.ipLimiter;

  router.get('/plans', async (_req: Request, res: Response) => {
    const regions = await listRegionalPrices(deps.db);
    const published = regions.map((region) => ({
      code: region.code,
      label: region.label,
      currency: region.currency,
      amountMinor: Number(region.amountMinor),
      placeholder: region.placeholder,
    }));
    const plans = plansForPublic(published);
    const full = plans.find((plan) => plan.id === 'full');
    if (full?.priceUsdCents === null) {
      deps.logger.warn('usd subscription price is not saved', { region: 'us' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      plans,
      regions: published,
    });
  });

  router.get('/activity', async (req: Request, res: Response) => {
    if (!activityLimiter.check(`public-activity|ip|${req.ip ?? 'unknown'}`)) {
      deps.logger.warn('public activity rate limited', { scope: 'ip' });
      throw new AppError('Too many requests, try again later', 429, 'rate_limited', true);
    }
    const body = await activity.read();
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.status(200).json(body);
  });

  router.post('/leads', async (req: Request, res: Response) => {
    const rawKey = req.header('x-site-key');
    const siteKey = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (!deps.ipLimiter.check(`public-lead|ip|${req.ip ?? 'unknown'}`)) {
      deps.logger.warn('public lead rate limited', { scope: 'ip' });
      throw new AppError('Too many lead submissions, try again later', 429, 'rate_limited', true);
    }
    if (siteKey !== '' && !deps.keyLimiter.check(`public-lead|key|${siteKey}`)) {
      deps.logger.warn('public lead rate limited', { scope: 'key' });
      throw new AppError('Too many lead submissions, try again later', 429, 'rate_limited', true);
    }

    if (siteKey === '') {
      throw new AppError('Invalid site key', 401, 'invalid_site_key', true);
    }

    const [orgs] = await deps.db.query<SiteKeyOrgRow[]>(
      "SELECT id FROM organizations WHERE site_key = ? AND status = 'active'",
      [siteKey],
    );
    const org = orgs[0];
    if (org === undefined) {
      throw new AppError('Invalid site key', 401, 'invalid_site_key', true);
    }

    const body = readJsonBody(req);
    const leadId = await createPublicLead(deps.db, deps.logger, {
      organizationId: org.id,
      body,
    });
    await triggerLeadCreated(deps.db, deps.logger, { organizationId: org.id, leadId });
    await runLeadAutomation(deps.db, deps.logger, {
      organizationId: org.id,
      leadId,
      mode: 'create',
    });
    res.status(201).json({ leadId });
  });

  return router;
}
