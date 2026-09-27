import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { revokeUserSessions } from '../auth/sessions';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { createUserInOrg } from '../services/users';
import { parsePathId } from '../validate';

export interface OrganizationsRouterDeps {
  db: Pool;
  logger: Logger;
}

interface OrganizationRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  created_at: Date;
}

interface UserListRow extends RowDataPacket {
  id: number;
  email: string;
  role: string;
  status: string;
  created_at: Date;
  last_login_at: Date | null;
}

interface UserTargetRow extends RowDataPacket {
  id: number;
  organization_id: number | null;
  email: string;
}

export function createOrganizationsRouter(deps: OrganizationsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    assertOrgExists(req.user as SessionUser, organizationId);
    const [rows] = await deps.db.query<OrganizationRow[]>(
      'SELECT id, name, status, created_at FROM organizations WHERE id = ?',
      [organizationId],
    );
    if (rows[0] === undefined) {
      throw new AppError('Organization not found', 404, 'not_found', true);
    }
    res.status(200).json({
      organization: {
        id: rows[0].id,
        name: rows[0].name,
        status: rows[0].status,
        createdAt: rows[0].created_at,
      },
    });
  });

  router.get('/:orgId/users', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    assertCanManageMembers(req.user as SessionUser, organizationId);
    const [rows] = await deps.db.query<UserListRow[]>(
      `SELECT id, email, role, status, created_at, last_login_at
       FROM users WHERE organization_id = ? ORDER BY id`,
      [organizationId],
    );
    res.status(200).json({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      })),
    });
  });

  router.post('/:orgId/users', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const user = await createUserInOrg(deps.db, deps.logger, organizationId, req.body, actor.id);
    res.status(201).json({ user });
  });

  router.delete('/:orgId/users/:userId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const userId = parsePathId(req.params.userId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);

    if (userId === actor.id) {
      throw new AppError('Cannot disable your own account', 400, 'cannot_disable_self', true);
    }

    const [rows] = await deps.db.query<UserTargetRow[]>(
      'SELECT id, organization_id, email FROM users WHERE id = ?',
      [userId],
    );
    const target = rows[0];
    if (target === undefined || target.organization_id !== organizationId) {
      throw new AppError('User not found', 404, 'not_found', true);
    }

    await deps.db.query("UPDATE users SET status = 'disabled' WHERE id = ?", [userId]);
    await revokeUserSessions(deps.db, userId);
    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId: actor.id,
      action: 'user_disabled',
      detail: `target=${target.email}`,
    });
    res.status(200).json({ ok: true });
  });

  return router;
}
