import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { triggerLeadCreated } from '../automation/leadCreated';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import type { RateLimiter } from '../security/rateLimit';
import { createPublicLead } from '../services/leads';

export interface PublicRouterDeps {
  db: Pool;
  logger: Logger;
  ipLimiter: RateLimiter;
  keyLimiter: RateLimiter;
}

interface SiteKeyOrgRow extends RowDataPacket {
  id: number;
}

export function createPublicRouter(deps: PublicRouterDeps): Router {
  const router = Router();

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
    res.status(201).json({ leadId });
  });

  return router;
}
