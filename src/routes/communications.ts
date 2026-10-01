import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import { listMessages } from '../services/messages';
import { parsePathId } from '../validate';

export interface CommunicationsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createCommunicationsRouter(deps: CommunicationsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/communications', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const result = await listMessages(deps.db, {
      organizationId,
      query: req.query as unknown as Record<string, unknown>,
    });
    res.status(200).json({
      messages: result.messages,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  });

  return router;
}
