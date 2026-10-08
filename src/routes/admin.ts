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
import {
  gatewayReadiness,
  loadPaymentGatewayConfig,
  savePaymentGatewayConfig,
} from '../payments/gatewayConfig';
import type { PaymentGatewayConfig, PaymentGatewayProvider } from '../payments/gatewayConfig';
import { PAYMENT_GATEWAY_PROVIDERS } from '../payments/gatewayConfig';
import { createPaymentGateway } from '../payments/registry';
import { parsePathId, requireChoice, requirePassword, requireString, ValidationError } from '../validate';
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

interface TrialRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  trial_ends_at: Date | null;
}

interface ActivateRow extends RowDataPacket {
  id: number;
  name: string;
  status: 'active' | 'disabled';
  plan: 'trial' | 'full';
  trial_ends_at: Date | null;
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

  router.get('/trials', async (_req: Request, res: Response) => {
    const [rows] = await deps.db.query<TrialRow[]>(
      `SELECT id, name, status, trial_ends_at FROM organizations
       WHERE plan = 'trial'
       ORDER BY (trial_ends_at IS NULL), trial_ends_at, id`,
    );
    res.status(200).json({
      trials: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        trialEndsAt: row.trial_ends_at,
      })),
    });
  });

  router.post('/organizations/:orgId/activate', async (req: Request, res: Response) => {
    const organizationId = parsePathId(req.params.orgId ?? '');
    const actor = req.user as SessionUser;
    const [rows] = await deps.db.query<ActivateRow[]>(
      'SELECT id, name, status, plan, trial_ends_at FROM organizations WHERE id = ?',
      [organizationId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('Organization not found', 404, 'not_found', true);
    }
    if (row.plan !== 'trial') {
      res.status(200).json({
        organization: { id: row.id, name: row.name, status: row.status, plan: row.plan },
        activated: false,
      });
      return;
    }
    await deps.db.query(
      "UPDATE organizations SET plan = 'full', trial_ends_at = NULL WHERE id = ?",
      [organizationId],
    );
    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId: actor.id,
      action: 'trial_activated',
      detail: 'from=trial to=full',
    });
    res.status(200).json({
      organization: { id: row.id, name: row.name, status: row.status, plan: 'full' },
      activated: true,
    });
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

  router.get('/payment-gateway', async (_req: Request, res: Response) => {
    const config = await loadPaymentGatewayConfig(deps.db);
    res.status(200).json({ gateway: gatewayDto(config) });
  });

  router.patch('/payment-gateway', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const current = await loadPaymentGatewayConfig(deps.db);
    const next: PaymentGatewayConfig = { ...current };

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        throw new ValidationError('Validation failed', ['enabled must be a boolean']);
      }
      next.enabled = body.enabled;
    }
    if (body.provider !== undefined) {
      next.provider = requireChoice(
        body.provider,
        PAYMENT_GATEWAY_PROVIDERS,
        'provider',
      ) as PaymentGatewayProvider;
    }
    if (body.merchantId !== undefined) {
      next.merchantId = configString(body.merchantId, 'merchantId', 120);
    }
    if (body.storeName !== undefined) {
      next.storeName = configString(body.storeName, 'storeName', 120);
    }
    if (body.baseUrl !== undefined) {
      next.baseUrl = configUrl(body.baseUrl, 'baseUrl');
    }
    if (body.returnUrlBase !== undefined) {
      next.returnUrlBase = configUrl(body.returnUrlBase, 'returnUrlBase');
    }

    await savePaymentGatewayConfig(deps.db, next);
    const actor = req.user as SessionUser;
    await recordAudit(deps.db, deps.logger, {
      organizationId: null,
      userId: actor.id,
      action: 'payment_gateway_config_updated',
      detail: `provider=${next.provider} enabled=${next.enabled} baseUrlSet=${next.baseUrl !== ''}`,
    });
    res.status(200).json({ gateway: gatewayDto(next) });
  });

  router.post('/payment-gateway/test', async (_req: Request, res: Response) => {
    const config = await loadPaymentGatewayConfig(deps.db);
    const result = await createPaymentGateway(config).testConnection();
    res.status(200).json({ result });
  });

  return router;
}

function gatewayDto(config: PaymentGatewayConfig): Record<string, unknown> {
  const readiness = gatewayReadiness(config);
  return {
    enabled: config.enabled,
    provider: config.provider,
    merchantId: config.merchantId,
    storeName: config.storeName,
    baseUrl: config.baseUrl,
    returnUrlBase: config.returnUrlBase,
    state: readiness.configured ? 'green' : 'red',
    reasons: readiness.reasons,
  };
}

function configString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Validation failed', [`${name} must be a string`]);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ValidationError('Validation failed', [`${name} must be at most ${max} characters`]);
  }
  return trimmed;
}

function configUrl(value: unknown, name: string): string {
  const text = configString(value, name, 512);
  if (text === '') {
    return '';
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ValidationError('Validation failed', [
      `${name} must be an absolute URL (e.g. https://example.com)`,
    ]);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('Validation failed', [`${name} must use http or https`]);
  }
  return text;
}
