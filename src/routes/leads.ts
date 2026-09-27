import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { triggerLeadCreated } from '../automation/leadCreated';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { createLead, deleteLead, getLeadDetail, listLeads, updateLead } from '../services/leads';
import { parsePathId } from '../validate';

export interface LeadsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createLeadsRouter(deps: LeadsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/leads', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const result = await listLeads(deps.db, {
      organizationId,
      query: req.query as unknown as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/leads', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const body = readJsonBody(req);
    const created = await createLead(deps.db, deps.logger, {
      organizationId,
      actorId: actor.id,
      body,
    });
    const leadId = (created.lead as { id: number }).id;
    await triggerLeadCreated(deps.db, deps.logger, { organizationId, leadId });
    res.status(201).json(created);
  });

  router.get('/:orgId/leads/:leadId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const leadId = parsePathId(req.params.leadId);
    const detail = await getLeadDetail(deps.db, organizationId, leadId);
    if (detail === null) {
      throw new AppError('Lead not found', 404, 'not_found', true);
    }
    res.status(200).json(detail);
  });

  router.patch('/:orgId/leads/:leadId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const leadId = parsePathId(req.params.leadId);
    const body = readJsonBody(req);
    const updated = await updateLead(deps.db, deps.logger, {
      organizationId,
      leadId,
      actorId: actor.id,
      actorRole: actor.role,
      body,
    });
    res.status(200).json(updated);
  });

  router.delete('/:orgId/leads/:leadId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const leadId = parsePathId(req.params.leadId);
    const deleted = await deleteLead(deps.db, deps.logger, organizationId, leadId, actor.id);
    if (!deleted) {
      throw new AppError('Lead not found', 404, 'not_found', true);
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
