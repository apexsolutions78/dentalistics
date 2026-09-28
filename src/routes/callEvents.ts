import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { retryMissedCallResponse } from '../automation/missedCall';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import { loadCallEvent } from '../services/callEvents';
import { parsePathId } from '../validate';

export interface CallEventsRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createCallEventsRouter(deps: CallEventsRouterDeps): Router {
  const router = Router();

  router.use(requireAuth);

  router.post('/:orgId/call-events/:callEventId/retry', async (req: Request, res: Response) => {
    const actor = req.user as SessionUser;
    const organizationId = parsePathId(req.params.orgId);
    const callEventId = parsePathId(req.params.callEventId);
    assertCanManageMembers(actor, organizationId);

    const event = await loadCallEvent(deps.db, organizationId, callEventId);
    if (event === null) {
      throw new AppError('Call event not found', 404, 'not_found', true);
    }
    if (event.message_id === null) {
      throw new AppError('Call event has no response message to retry', 409, 'no_message', true);
    }

    const result = await retryMissedCallResponse(deps.db, deps.logger, {
      organizationId,
      providerKey: event.provider_key,
      eventId: event.provider_event_id,
    });

    if (result.action === 'not_found') {
      throw new AppError('Message not found', 404, 'not_found', true);
    }
    if (result.action === 'error') {
      throw new AppError('Retry failed', 500, 'retry_failed', false);
    }

    if (result.action === 'sent') {
      await deps.db.query(
        `UPDATE call_events
         SET status = 'PROCESSED', last_error = NULL
         WHERE id = ? AND organization_id = ?`,
        [callEventId, organizationId],
      );
    }

    res.status(200).json({ action: result.action, messageId: result.messageId ?? null });
  });

  return router;
}
