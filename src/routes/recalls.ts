import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import { listRecalls } from '../services/recalls';
import { parsePathId } from '../validate';

export interface RecallsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createRecallsRouter(deps: RecallsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/recalls', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const result = await listRecalls(deps.db, {
      organizationId,
      query: req.query as unknown as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  return router;
}
