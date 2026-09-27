import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { createPatient, deletePatient, getPatient, listPatients, updatePatient } from '../services/patients';
import { parsePathId } from '../validate';

export interface PatientsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createPatientsRouter(deps: PatientsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/patients', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const result = await listPatients(deps.db, {
      organizationId,
      query: req.query as unknown as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/patients', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const body = readJsonBody(req);
    const created = await createPatient(deps.db, deps.logger, {
      organizationId,
      actorId: actor.id,
      body,
    });
    res.status(201).json(created);
  });

  router.get('/:orgId/patients/:patientId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const result = await getPatient(deps.db, organizationId, patientId);
    if (result === null) {
      throw new AppError('Patient not found', 404, 'not_found', true);
    }
    res.status(200).json(result);
  });

  router.patch('/:orgId/patients/:patientId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const body = readJsonBody(req);
    const updated = await updatePatient(deps.db, deps.logger, { organizationId, patientId, body });
    res.status(200).json(updated);
  });

  router.delete('/:orgId/patients/:patientId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const patientId = parsePathId(req.params.patientId);
    const deleted = await deletePatient(deps.db, deps.logger, organizationId, patientId, actor.id);
    if (!deleted) {
      throw new AppError('Patient not found', 404, 'not_found', true);
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
