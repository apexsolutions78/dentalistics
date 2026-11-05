import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { ValidationError } from '../errors';
import { readJsonBody } from '../http/body';
import { requireAuth } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import { listAutomationFlows, setAutomationFlowEnabled } from '../services/automationFlows';
import { parsePathId, requireString } from '../validate';

export function createAutomationFlowsRouter(deps: { db: Pool }): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/automation-flows', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    res.status(200).json({ flows: await listAutomationFlows(deps.db, organizationId) });
  });

  router.patch('/:orgId/automation-flows/:key', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const key = requireString(req.params.key, 'key', { min: 2, max: 40 });
    const body = readJsonBody(req);
    if (typeof body.enabled !== 'boolean') {
      throw new ValidationError('Invalid input', ['enabled must be a boolean']);
    }
    const flow = await setAutomationFlowEnabled(deps.db, actor, organizationId, key, body.enabled);
    res.status(200).json({ flow });
  });

  return router;
}
