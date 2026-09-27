import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import {
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  createAppointment,
  getAppointment,
  listAppointments,
  noShowAppointment,
  rebookAppointment,
  rescheduleAppointment,
  updateAppointment,
} from '../services/appointments';
import { parsePathId } from '../validate';

export interface AppointmentsRouterDeps {
  db: Pool;
  logger: Logger;
}

function requireAppointment(
  result: Record<string, unknown> | null,
): Record<string, unknown> {
  if (result === null) {
    throw new AppError('Appointment not found', 404, 'not_found', true);
  }
  return result;
}

export function createAppointmentsRouter(deps: AppointmentsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId/appointments', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const result = await listAppointments(deps.db, {
      organizationId,
      query: req.query as unknown as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const body = readJsonBody(req);
    const created = await createAppointment(deps.db, deps.logger, {
      organizationId,
      actorId: actor.id,
      body,
    });
    res.status(201).json(created);
  });

  router.get('/:orgId/appointments/:appointmentId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const result = await getAppointment(deps.db, organizationId, appointmentId);
    res.status(200).json(requireAppointment(result));
  });

  router.patch('/:orgId/appointments/:appointmentId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const body = readJsonBody(req);
    const updated = await updateAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
      body,
    });
    res.status(200).json(updated);
  });

  router.post('/:orgId/appointments/:appointmentId/confirm', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const result = await confirmAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments/:appointmentId/cancel', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const result = await cancelAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments/:appointmentId/complete', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const result = await completeAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments/:appointmentId/no-show', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const result = await noShowAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments/:appointmentId/reschedule', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const body = readJsonBody(req);
    const result = await rescheduleAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
      body,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/appointments/:appointmentId/rebook', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    const actor = req.user as SessionUser;
    assertOrgExists(actor, organizationId);
    const appointmentId = parsePathId(req.params.appointmentId);
    const body = readJsonBody(req);
    const result = await rebookAppointment(deps.db, deps.logger, {
      organizationId,
      appointmentId,
      actorId: actor.id,
      body,
    });
    res.status(200).json(result);
  });

  return router;
}
