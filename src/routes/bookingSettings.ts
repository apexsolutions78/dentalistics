import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import { getBookingSettings, saveBookingSettings } from '../services/onlineBooking';
import { parsePathId } from '../validate';

export interface BookingSettingsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createBookingSettingsRouter(deps: BookingSettingsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  function authorize(req: Request): { organizationId: number; actor: SessionUser } {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    return { organizationId, actor };
  }

  router.get('/:orgId/booking', async (req: Request, res: Response) => {
    const { organizationId } = authorize(req);
    const booking = await getBookingSettings(deps.db, organizationId);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ booking });
  });

  router.patch('/:orgId/booking', async (req: Request, res: Response) => {
    const { organizationId, actor } = authorize(req);
    const booking = await saveBookingSettings(
      deps.db,
      deps.logger,
      organizationId,
      actor.id,
      readJsonBody(req),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ booking });
  });

  return router;
}
