import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertOrgExists } from '../middleware/tenant';
import { normalizePhone, parsePathId } from '../validate';

export interface ConversationStateRouterDeps {
  db: Pool;
  logger: Logger;
}

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createConversationStateRouter(deps: ConversationStateRouterDeps): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/:orgId/conversation-state', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId);
    assertOrgExists(req.user as SessionUser, organizationId);
    const phone = normalizePhone(req.query.phone, 'phone');

    const [rows] = await deps.db.query<RowDataPacket[]>(
      `SELECT created_at FROM communication_messages
       WHERE organization_id = ? AND channel = 'WHATSAPP' AND direction = 'INBOUND' AND recipient = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [organizationId, phone],
    );

    const rawLast = rows[0]?.created_at;
    const lastInboundAt = rawLast instanceof Date ? rawLast : null;
    const windowExpiresAt =
      lastInboundAt === null ? null : new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
    const windowOpen = windowExpiresAt !== null && windowExpiresAt.getTime() > Date.now();

    res.status(200).json({
      phone,
      lastInboundAt,
      windowExpiresAt,
      windowOpen,
    });
  });

  return router;
}
