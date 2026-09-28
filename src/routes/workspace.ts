import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import { getReceptionistWorkspace } from '../services/workspace';
import { parsePathId } from '../validate';

export interface WorkspaceRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createWorkspaceRouter(deps: WorkspaceRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/receptionist/workspace', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const workspace = await getReceptionistWorkspace(deps.db, { organizationId });
    res.status(200).json(workspace);
  });

  return router;
}
