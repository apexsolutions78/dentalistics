import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import { getDashboard, resolveDashboardRange } from '../services/dashboard';
import { parsePathId } from '../validate';

export interface DashboardRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createDashboardRouter(deps: DashboardRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/dashboard', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertCanManageMembers(req.user as SessionUser, organizationId);
    const query = req.query as unknown as Record<string, unknown>;
    const range = resolveDashboardRange(query.from, query.to);
    const result = await getDashboard(deps.db, { organizationId, ...range });
    res.status(200).json(result);
  });

  return router;
}
