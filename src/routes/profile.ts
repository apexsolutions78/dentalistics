import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import type { SessionUser } from '../auth/sessions';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { getProfile, updateProfile } from '../services/profile';

export function createProfileRouter(deps: { db: Pool; logger: Logger }): Router {
  const router = Router();

  router.get('/', requireAuth, async (req: Request, res: Response) => {
    const user = req.user as SessionUser;
    res.status(200).json(await getProfile(deps.db, user.id));
  });

  router.patch('/', requireAuth, async (req: Request, res: Response) => {
    const user = req.user as SessionUser;
    const profile = await updateProfile(deps.db, deps.logger, user, readJsonBody(req));
    res.status(200).json(profile);
  });

  return router;
}
