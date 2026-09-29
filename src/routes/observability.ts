import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import {
  FAILED_JOB_KINDS,
  getDiagnostics,
  listAutomationLogs,
  listAuditLogs,
  listErrorEvents,
  listFailedJobs,
  listWebhookEvents,
  retryFailedJob,
} from '../services/observability';
import { listMessages } from '../services/messages';
import { requireChoice, parsePathId } from '../validate';
import { tickIntervalMs, tickSnapshot } from '../tickState';

export interface ObservabilityRouterDeps {
  db: Pool;
  logger: Logger;
}

export function createObservabilityRouter(deps: ObservabilityRouterDeps): Router {
  const router = Router();

  router.use(requireAuth);

  function context(req: Request): number {
    const actor = req.user as SessionUser;
    const organizationId = parsePathId(req.params.orgId);
    assertCanManageMembers(actor, organizationId);
    return organizationId;
  }

  router.get('/:orgId/observability/automation-logs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const result = await listAutomationLogs(deps.db, {
      organizationId,
      query: req.query as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.get('/:orgId/observability/communication-logs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const query = req.query as Record<string, unknown>;
    const result = await listMessages(deps.db, { organizationId, query });
    res.status(200).json({ messages: result.messages, total: result.total, limit: result.limit, offset: result.offset });
  });

  router.get('/:orgId/observability/webhook-logs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const result = await listWebhookEvents(deps.db, {
      organizationId,
      query: req.query as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.get('/:orgId/observability/error-logs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const result = await listErrorEvents(deps.db, organizationId, req.query as Record<string, unknown>);
    res.status(200).json(result);
  });

  router.get('/:orgId/observability/audit-logs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const result = await listAuditLogs(deps.db, organizationId, req.query as Record<string, unknown>);
    res.status(200).json(result);
  });

  router.get('/:orgId/observability/failed-jobs', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const result = await listFailedJobs(deps.db, {
      organizationId,
      query: req.query as Record<string, unknown>,
    });
    res.status(200).json(result);
  });

  router.post('/:orgId/observability/failed-jobs/:kind/:id/retry', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const kind = requireChoice(req.params.kind, FAILED_JOB_KINDS, 'kind');
    const id = parsePathId(req.params.id);
    const result = await retryFailedJob(deps.db, deps.logger, organizationId, kind, id);
    res.status(200).json({ retry: result });
  });

  router.get('/:orgId/observability/diagnostics', async (req: Request, res: Response) => {
    const organizationId = context(req);
    const diagnostics = await getDiagnostics(deps.db, organizationId, {
      intervalMs: tickIntervalMs(),
      ticks: tickSnapshot(),
    });
    res.status(200).json({ diagnostics });
  });

  return router;
}
