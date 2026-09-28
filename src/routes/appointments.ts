import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import {
  cancelRemindersForAppointment,
  scheduleRemindersForAppointment,
} from '../automation/reminders';
import { closeNoShowCase, startNoShowRecovery } from '../automation/noShow';
import {
  closeRecallOnVisitCompleted,
  closeRecallsForPatientOnBooking,
  closeRecall,
  createRecallForCompletedAppointment,
} from '../automation/recall';
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

function appointmentIdOf(result: Record<string, unknown>): number {
  const appt = result.appointment as { id: number } | undefined;
  return appt?.id ?? 0;
}

async function safeScheduleReminders(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<void> {
  if (appointmentId === 0) {
    return;
  }
  try {
    await scheduleRemindersForAppointment(db, logger, appointmentId);
  } catch (err) {
    logger.error('reminder scheduling failed', {
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeCancelReminders(
  db: Pool,
  logger: Logger,
  appointmentId: number,
  reason: string,
): Promise<void> {
  try {
    await cancelRemindersForAppointment(db, logger, appointmentId, reason);
  } catch (err) {
    logger.error('reminder cancellation failed', {
      appointmentId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeStartNoShowRecovery(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<void> {
  if (appointmentId === 0) {
    return;
  }
  try {
    await startNoShowRecovery(db, logger, { appointmentId });
  } catch (err) {
    logger.error('no-show recovery start failed', {
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeCloseNoShowOnRebook(
  db: Pool,
  logger: Logger,
  appointmentId: number,
  rebookedAppointmentId: number,
): Promise<void> {
  if (appointmentId === 0 || rebookedAppointmentId === 0) {
    return;
  }
  try {
    await closeNoShowCase(db, logger, {
      appointmentId,
      reason: 'rebooked',
      rebookedAppointmentId,
    });
  } catch (err) {
    logger.error('no-show recovery close on rebook failed', {
      appointmentId,
      rebookedAppointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeCreateRecall(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<void> {
  if (appointmentId === 0) {
    return;
  }
  try {
    await createRecallForCompletedAppointment(db, logger, { appointmentId });
  } catch (err) {
    logger.error('recall creation failed', {
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeCloseRecallOnBooking(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<void> {
  if (appointmentId === 0) {
    return;
  }
  try {
    await closeRecallsForPatientOnBooking(db, logger, appointmentId);
  } catch (err) {
    logger.error('recall close on booking failed', {
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeCloseRecallOnVisitCompleted(
  db: Pool,
  logger: Logger,
  appointmentId: number,
): Promise<void> {
  if (appointmentId === 0) {
    return;
  }
  try {
    await closeRecallOnVisitCompleted(db, logger, appointmentId);
  } catch (err) {
    logger.error('recall close on visit completion failed', {
      appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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
    await safeScheduleReminders(deps.db, deps.logger, appointmentIdOf(created));
    await safeCloseRecallOnBooking(deps.db, deps.logger, appointmentIdOf(created));
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
    await safeCancelReminders(deps.db, deps.logger, appointmentId, 'appointment_cancelled');
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
    await safeCancelReminders(deps.db, deps.logger, appointmentId, 'appointment_completed');
    await safeCloseRecallOnVisitCompleted(deps.db, deps.logger, appointmentId);
    await safeCreateRecall(deps.db, deps.logger, appointmentId);
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
    await safeCancelReminders(deps.db, deps.logger, appointmentId, 'appointment_no_show');
    await safeStartNoShowRecovery(deps.db, deps.logger, appointmentId);
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
    await safeCancelReminders(deps.db, deps.logger, appointmentId, 'appointment_rescheduled');
    await safeScheduleReminders(deps.db, deps.logger, appointmentIdOf(result));
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
    await safeScheduleReminders(deps.db, deps.logger, appointmentIdOf(result));
    await safeCloseRecallOnBooking(deps.db, deps.logger, appointmentIdOf(result));
    await safeCloseNoShowOnRebook(
      deps.db,
      deps.logger,
      appointmentId,
      appointmentIdOf(result),
    );
    res.status(200).json(result);
  });

  router.post(
    '/:orgId/appointments/:appointmentId/noshow/close',
    async (req: Request, res: Response) => {
      const organizationId = parsePathId(req.params.orgId);
      const actor = req.user as SessionUser;
      assertCanManageMembers(actor, organizationId);
      const appointmentId = parsePathId(req.params.appointmentId);
      const body = readJsonBody(req) as Record<string, unknown>;
      const rawReason = body.reason;
      const reason =
        typeof rawReason === 'string' && rawReason.trim() !== ''
          ? rawReason.trim().slice(0, 64)
          : 'staff_closed';
      const result = await closeNoShowCase(deps.db, deps.logger, {
        appointmentId,
        organizationId,
        reason,
      });
      if (!result.closed) {
        throw new AppError(
          'No open no-show case for this appointment',
          404,
          'not_found',
          true,
        );
      }
      res.status(200).json({
        case: {
          id: result.caseId,
          appointmentId,
          status: result.status,
          closeReason: reason,
        },
      });
    },
  );

  router.post(
    '/:orgId/recalls/:recallId/close',
    async (req: Request, res: Response) => {
      const organizationId = parsePathId(req.params.orgId);
      const actor = req.user as SessionUser;
      assertCanManageMembers(actor, organizationId);
      const recallId = parsePathId(req.params.recallId);
      const body = readJsonBody(req) as Record<string, unknown>;
      const rawReason = body.reason;
      const reason =
        typeof rawReason === 'string' && rawReason.trim() !== ''
          ? rawReason.trim().slice(0, 64)
          : 'staff_closed';
      const result = await closeRecall(deps.db, deps.logger, {
        recallId,
        organizationId,
        reason,
      });
      if (!result.closed) {
        throw new AppError('No open recall for this id', 404, 'not_found', true);
      }
      res.status(200).json({
        recall: {
          id: result.recallId,
          status: result.status,
          closeReason: reason,
        },
      });
    },
  );

  return router;
}
