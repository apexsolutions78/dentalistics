import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { hashPassword } from '../auth/password';
import { revokeUserSessions } from '../auth/sessions';
import type { SessionUser } from '../auth/sessions';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth, requireRole } from '../middleware/auth';
import { listAuditLogs, listErrorEvents } from '../services/observability';
import { createUserInOrg } from '../services/users';
import { parsePathId, requirePassword, requireString } from '../validate';
export interface AdminRouterDeps {
  db: Pool;
  logger: Logger;
}

interface OrganizationRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  created_at: Date;
}

interface AdminUserTargetRow extends RowDataPacket {
  id: number;
  email: string;
  organization_id: number | null;
}

function orgDto(row: OrganizationRow): Record<string, unknown> {
  return { id: row.id, name: row.name, status: row.status, createdAt: row.created_at };
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  router.use(requireAuth, requireRole('admin'));

  router.post('/organizations', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const name = requireString(body.name, 'name', { min: 2, max: 120 });
    const actor = req.user as SessionUser;
    const [result] = await deps.db.query('INSERT INTO organizations (name) VALUES (?)', [name]);
    const organizationId = (result as { insertId: number }).insertId;
    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId: actor.id,
      action: 'organization_created',
      detail: `name=${name}`,
    });
    const [rows] = await deps.db.query<OrganizationRow[]>(
      'SELECT id, name, status, created_at FROM organizations WHERE id = ?',
      [organizationId],
    );
    res.status(201).json({ organization: orgDto(rows[0] as OrganizationRow) });
  });

  router.get('/organizations', async (_req: Request, res: Response) => {
    const [rows] = await deps.db.query<OrganizationRow[]>(
      'SELECT id, name, status, created_at FROM organizations ORDER BY id',
    );
    res.status(200).json({ organizations: rows.map(orgDto) });
  });

  router.post('/organizations/:orgId/users', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    const [orgRows] = await deps.db.query<OrganizationRow[]>(
      'SELECT id, name, status, created_at FROM organizations WHERE id = ?',
      [organizationId],
    );
    if (orgRows[0] === undefined) {
      throw new AppError('Organization not found', 404, 'not_found', true);
    }
    const user = await createUserInOrg(deps.db, deps.logger, organizationId, req.body, actor.id);
    res.status(201).json({ user });
  });

  router.post('/users/:userId/password', async (req: Request, res: Response) => {
    const userId = parsePathId(req.params.userId ?? '');
    const body = readJsonBody(req);
    const newPassword = requirePassword(body.newPassword, 'newPassword');
    const actor = req.user as SessionUser;

    const [rows] = await deps.db.query<AdminUserTargetRow[]>(
      'SELECT id, email, organization_id FROM users WHERE id = ?',
      [userId],
    );
    if (rows[0] === undefined) {
      throw new AppError('User not found', 404, 'not_found', true);
    }
    const newHash = await hashPassword(newPassword);
    await deps.db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    await revokeUserSessions(deps.db, userId);
    await recordAudit(deps.db, deps.logger, {
      organizationId: rows[0].organization_id,
      userId: actor.id,
      action: 'user_password_reset',
      detail: `target=${rows[0].email}`,
    });
    res.status(200).json({ ok: true });
  });

  router.get('/observability/error-logs', async (req: Request, res: Response) => {
    const result = await listErrorEvents(deps.db, null, req.query as Record<string, unknown>);
    res.status(200).json(result);
  });

  router.get('/observability/audit-logs', async (req: Request, res: Response) => {
    const result = await listAuditLogs(deps.db, null, req.query as Record<string, unknown>);
    res.status(200).json(result);
  });

  return router;
}
