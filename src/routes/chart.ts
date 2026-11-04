import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import {
  createTreatmentPlanItem,
  deleteTreatmentPlanItem,
  getPatientChart,
  saveToothChart,
  updateTreatmentPlanItem,
} from '../clinical/chart';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { parsePathId } from '../validate';

export interface ChartRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createChartRouter(deps: ChartRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/patients/:patientId/chart', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const chart = await getPatientChart(deps.db, organizationId, patientId);
    res.status(200).json(chart);
  });

  router.put('/:orgId/patients/:patientId/chart/teeth/:tooth', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const tooth = Array.isArray(req.params.tooth) ? (req.params.tooth[0] ?? '') : (req.params.tooth ?? '');
    const saved = await saveToothChart(deps.db, deps.logger, {
      organizationId,
      patientId,
      actorId: actor.id,
      tooth,
      body: readJsonBody(req),
    });
    res.status(200).json(saved);
  });

  router.post('/:orgId/patients/:patientId/treatment-plan', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const created = await createTreatmentPlanItem(deps.db, deps.logger, {
      organizationId,
      patientId,
      actorId: actor.id,
      body: readJsonBody(req),
    });
    res.status(201).json(created);
  });

  router.patch('/:orgId/patients/:patientId/treatment-plan/:itemId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const itemId = parsePathId(req.params.itemId);
    const updated = await updateTreatmentPlanItem(deps.db, deps.logger, {
      organizationId,
      patientId,
      itemId,
      actorId: actor.id,
      body: readJsonBody(req),
    });
    res.status(200).json(updated);
  });

  router.delete('/:orgId/patients/:patientId/treatment-plan/:itemId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const itemId = parsePathId(req.params.itemId);
    const deleted = await deleteTreatmentPlanItem(deps.db, deps.logger, {
      organizationId,
      patientId,
      itemId,
      actorId: actor.id,
    });
    if (!deleted) {
      throw new AppError('Treatment plan item not found', 404, 'not_found', true);
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
