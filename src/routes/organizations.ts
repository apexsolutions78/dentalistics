import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { revokeUserSessions } from '../auth/sessions';
import type { SessionUser } from '../auth/sessions';
import { AppError, ValidationError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import { requireAuth } from '../middleware/auth';
import { assertCanManageMembers, assertOrgExists } from '../middleware/tenant';
import { createUserInOrg } from '../services/users';
import { generateSiteKey } from '../security/siteKey';
import { parsePathId, parseReviewUrl, parseTimezone } from '../validate';

export interface OrganizationsRouterDeps {
  db: Pool;
  logger: Logger;
}

interface OrganizationRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  timezone: string;
  review_url: string | null;
  created_at: Date;
  site_key: string | null;
  plan: 'trial' | 'full';
  trial_ends_at: Date | null;
  onboarding_completed_at: Date | null;
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

async function loadOrganization(
  db: Pool,
  organizationId: number,
): Promise<{
  organizationId: number;
  name: string;
  status: string;
  timezone: string;
  reviewUrl: string | null;
  createdAt: Date;
  siteKey: string;
  plan: 'trial' | 'full';
  trialEndsAt: Date | null;
  onboardingCompletedAt: Date | null;
}> {
  const [rows] = await db.query<OrganizationRow[]>(
    `SELECT id, name, status, timezone, review_url, created_at, site_key,
            plan, trial_ends_at, onboarding_completed_at
     FROM organizations WHERE id = ?`,
    [organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new AppError('Organization not found', 404, 'not_found', true);
  }
  let siteKey = row.site_key;
  if (siteKey === null) {
    siteKey = generateSiteKey();
    await db.query(
      'UPDATE organizations SET site_key = ? WHERE id = ? AND site_key IS NULL',
      [siteKey, organizationId],
    );
    const [again] = await db.query<OrganizationRow[]>(
      'SELECT site_key FROM organizations WHERE id = ?',
      [organizationId],
    );
    siteKey = again[0]?.site_key ?? siteKey;
  }
  return {
    organizationId: row.id,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    reviewUrl: row.review_url,
    createdAt: row.created_at,
    siteKey,
    plan: row.plan,
    trialEndsAt: row.trial_ends_at,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

function organizationDto(org: Awaited<ReturnType<typeof loadOrganization>>): Record<string, unknown> {
  return {
    id: org.organizationId,
    name: org.name,
    status: org.status,
    timezone: org.timezone,
    reviewUrl: org.reviewUrl,
    createdAt: org.createdAt,
    siteKey: org.siteKey,
    plan: org.plan,
    trialEndsAt: org.trialEndsAt,
    onboardingCompletedAt: org.onboardingCompletedAt,
  };
}

export function createOrganizationsRouter(deps: OrganizationsRouterDeps): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/:orgId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    assertOrgExists(req.user as SessionUser, organizationId);
    const org = await loadOrganization(deps.db, organizationId);
    res.status(200).json({ organization: organizationDto(org) });
  });

  router.patch('/:orgId', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const body = readJsonBody(req);
    const provided = Object.keys(body);
    if (provided.length === 0) {
      throw new ValidationError('Invalid input', ['at least one field to update is required']);
    }
    for (const key of provided) {
      if (key !== 'timezone' && key !== 'reviewUrl') {
        throw new ValidationError('Invalid input', [`unknown or not updatable field: ${key}`]);
      }
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.timezone !== undefined) {
      sets.push('timezone = ?');
      params.push(parseTimezone(body.timezone));
    }
    if (body.reviewUrl !== undefined) {
      sets.push('review_url = ?');
      params.push(parseReviewUrl(body.reviewUrl));
    }
    params.push(organizationId);
    const [result] = await deps.db.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
    if ((result as { affectedRows: number }).affectedRows === 0) {
      throw new AppError('Organization not found', 404, 'not_found', true);
    }
    deps.logger.info('organization settings updated', { organizationId, fields: provided });
    const org = await loadOrganization(deps.db, organizationId);
    res.status(200).json({ organization: organizationDto(org) });
  });

  router.post('/:orgId/onboarding/complete', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);
    const [result] = await deps.db.query(
      'UPDATE organizations SET onboarding_completed_at = UTC_TIMESTAMP() WHERE id = ? AND onboarding_completed_at IS NULL',
      [organizationId],
    );
    if ((result as { affectedRows: number }).affectedRows > 0) {
      await recordAudit(deps.db, deps.logger, {
        organizationId,
        userId: actor.id,
        action: 'onboarding_completed',
      });
      deps.logger.info('onboarding completed', { organizationId });
    }
    const org = await loadOrganization(deps.db, organizationId);
    res.status(200).json({ organization: organizationDto(org) });
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

  router.post('/:orgId/users/:userId/enable', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const userId = parsePathId(req.params.userId ?? '');
    const actor = req.user as SessionUser;
    assertCanManageMembers(actor, organizationId);

    const [rows] = await deps.db.query<UserTargetRow[]>(
      'SELECT id, organization_id, email FROM users WHERE id = ?',
      [userId],
    );
    const target = rows[0];
    if (target === undefined || target.organization_id !== organizationId) {
      throw new AppError('User not found', 404, 'not_found', true);
    }

    await deps.db.query("UPDATE users SET status = 'active' WHERE id = ?", [userId]);
    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId: actor.id,
      action: 'user_enabled',
      detail: `target=${target.email}`,
    });
    res.status(200).json({ ok: true });
  });

  return router;
}
