import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { triggerLeadCreated } from '../automation/leadCreated';
import { refreshLeadAutomation, runLeadAutomation } from '../automation/leadAutomation';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { createLead, deleteLead, getLeadDetail, listLeads, updateLead } from '../services/leads';
import {
  approveSuggestion,
  declineSuggestion,
  listSuggestionsForLead,
} from '../services/suggestions';
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
    await runLeadAutomation(deps.db, deps.logger, { organizationId, leadId, mode: 'create' });
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
    const suggestions = await listSuggestionsForLead(deps.db, organizationId, leadId);
    res.status(200).json({ ...detail, suggestions });
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
    await runLeadAutomation(deps.db, deps.logger, { organizationId, leadId, mode: 'update' });
    res.status(200).json(updated);
  });

  router.get('/:orgId/leads/:leadId/suggestions', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const leadId = parsePathId(req.params.leadId);
    const suggestions = await listSuggestionsForLead(deps.db, organizationId, leadId);
    res.status(200).json({ suggestions });
  });

  router.post('/:orgId/leads/:leadId/suggestions/refresh', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const leadId = parsePathId(req.params.leadId);
    const refreshed = await refreshLeadAutomation(deps.db, deps.logger, {
      organizationId,
      leadId,
    });
    const suggestions = await listSuggestionsForLead(deps.db, organizationId, leadId);
    res.status(200).json({ ...refreshed, suggestions });
  });

  router.post(
    '/:orgId/leads/:leadId/suggestions/:suggestionId/approve',
    async (req: Request, res: Response) => {
      const organizationId = parsePathId(req.params.orgId);
      const actor = req.user as SessionUser;
      assertOrgExists(actor, organizationId);
      const leadId = parsePathId(req.params.leadId);
      const suggestionId = parsePathId(req.params.suggestionId);
      const result = await approveSuggestion(deps.db, deps.logger, {
        organizationId,
        leadId,
        suggestionId,
        actorId: actor.id,
        body: readJsonBody(req),
      });
      res.status(201).json(result);
    },
  );

  router.post(
    '/:orgId/leads/:leadId/suggestions/:suggestionId/decline',
    async (req: Request, res: Response) => {
      const organizationId = parsePathId(req.params.orgId);
      const actor = req.user as SessionUser;
      assertOrgExists(actor, organizationId);
      const leadId = parsePathId(req.params.leadId);
      const suggestionId = parsePathId(req.params.suggestionId);
      const suggestion = await declineSuggestion(
        deps.db,
        deps.logger,
        organizationId,
        leadId,
        suggestionId,
        actor.id,
      );
      res.status(200).json({ suggestion });
    },
  );

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
