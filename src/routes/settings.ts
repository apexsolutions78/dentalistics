import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { ValidationError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers } from '../middleware/tenant';
import {
  getSettings,
  patchAutomation,
  patchClinic,
  patchProvider,
  patchTemplate,
  previewTemplate,
} from '../services/settings';
import { parsePathId } from '../validate';

export interface SettingsRouterDeps {
  db: Pool;
  logger: Logger;
}

function requireSection(value: string | string[] | undefined, name: string): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : value;
  if (raw === undefined || raw === '') {
    throw new ValidationError('Invalid input', [`${name} is required`]);
  }
  return raw;
}

export function createSettingsRouter(deps: SettingsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  function authorize(req: Request): { organizationId: number; actor: SessionUser } {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    return { organizationId, actor };
  }

  router.get('/:orgId/settings', async (req: Request, res: Response) => {
    const { organizationId } = authorize(req);
    const settings = await getSettings(deps.db, organizationId);
    res.status(200).json({ settings });
  });

  router.patch('/:orgId/settings/clinic', async (req: Request, res: Response) => {
    const { organizationId, actor } = authorize(req);
    const settings = await patchClinic(
      deps.db,
      deps.logger,
      organizationId,
      actor.id,
      readJsonBody(req),
    );
    res.status(200).json({ settings });
  });

  router.patch('/:orgId/settings/automations/:key', async (req: Request, res: Response) => {
    const { organizationId, actor } = authorize(req);
    const key = requireSection(req.params.key, 'key');
    const settings = await patchAutomation(
      deps.db,
      deps.logger,
      organizationId,
      actor.id,
      key,
      readJsonBody(req),
    );
    res.status(200).json({ settings });
  });

  router.patch('/:orgId/settings/providers/:key', async (req: Request, res: Response) => {
    const { organizationId, actor } = authorize(req);
    const key = requireSection(req.params.key, 'key');
    const settings = await patchProvider(
      deps.db,
      deps.logger,
      organizationId,
      actor.id,
      key,
      readJsonBody(req),
    );
    res.status(200).json({ settings });
  });

  router.patch('/:orgId/settings/templates/:templateName', async (req: Request, res: Response) => {
    const { organizationId, actor } = authorize(req);
    const templateName = requireSection(req.params.templateName, 'templateName');
    const settings = await patchTemplate(
      deps.db,
      deps.logger,
      organizationId,
      actor.id,
      templateName,
      readJsonBody(req),
    );
    res.status(200).json({ settings });
  });

  router.post('/:orgId/settings/templates/preview', async (req: Request, res: Response) => {
    const { organizationId } = authorize(req);
    const preview = await previewTemplate(deps.db, organizationId, readJsonBody(req));
    res.status(200).json(preview);
  });

  return router;
}
