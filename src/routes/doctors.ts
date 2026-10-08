import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import {
  createDoctor,
  deactivateDoctor,
  getDoctorAvailability,
  listDoctors,
  updateDoctor,
} from '../services/doctors';
import { assertOrgExists } from '../middleware/tenant';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { parseDateOnly, parsePathId } from '../validate';

export interface DoctorsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createDoctorsRouter(deps: DoctorsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/doctors', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const doctors = await listDoctors(deps.db, organizationId);
    res.status(200).json({ doctors });
  });

  router.post('/:orgId/doctors', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const created = await createDoctor(deps.db, deps.logger, {
      organizationId,
      actorId: actor.id,
      body: readJsonBody(req),
    });
    res.status(201).json(created);
  });

  router.get('/:orgId/doctors/:doctorId/availability', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const doctorId = parsePathId(req.params.doctorId);
    const date = parseDateOnly(req.query.date, 'date');
    const availability = await getDoctorAvailability(deps.db, organizationId, doctorId, date);
    res.status(200).json(availability);
  });

  router.patch('/:orgId/doctors/:doctorId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const doctorId = parsePathId(req.params.doctorId);
    const updated = await updateDoctor(deps.db, deps.logger, {
      organizationId,
      doctorId,
      actorId: actor.id,
      body: readJsonBody(req),
    });
    res.status(200).json(updated);
  });

  router.delete('/:orgId/doctors/:doctorId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const doctorId = parsePathId(req.params.doctorId);
    const result = await deactivateDoctor(deps.db, deps.logger, organizationId, doctorId, actor.id);
    res.status(200).json(result);
  });

  return router;
}
