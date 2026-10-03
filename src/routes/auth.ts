import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordAudit } from '../audit';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import {
  consumePasswordResetToken,
  issuePasswordResetToken,
  RESET_TOKEN_TTL_MINUTES,
} from '../auth/passwordReset';
import { createSession, revokeSession, revokeUserSessions } from '../auth/sessions';
import type { SessionUser } from '../auth/sessions';
import { AppError, ValidationError } from '../errors';
import { readJsonBody } from '../http/body';
import { buildClearCookie, buildSessionCookie, SESSION_TTL_HOURS } from '../http/cookies';
import type { Logger } from '../logger';
import type { PasswordResetMailer } from '../mail/passwordResetMailer';
import { requireAuth } from '../middleware/auth';
import { TRIAL_DAYS } from '../plans';
import type { RateLimiter } from '../security/rateLimit';
import { normalizeEmail, requirePassword, requireString } from '../validate';

export interface AuthRouterDeps {
  db: Pool;
  logger: Logger;
  secureCookies: boolean;
  loginLimiter: RateLimiter;
  resetRequestLimiter: RateLimiter;
  resetSubmitLimiter: RateLimiter;
  resetMailer: PasswordResetMailer;
  resetBaseUrl: string;
}

interface UserAuthRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  role: SessionUser['role'];
  organization_id: number | null;
  status: 'active' | 'disabled';
  org_status: 'active' | 'disabled' | null;
}

interface PasswordHashRow extends RowDataPacket {
  password_hash: string;
}

function userDto(user: SessionUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
}

interface OrgSummaryRow extends RowDataPacket {
  id: number;
  name: string;
  plan: 'trial' | 'full';
  trial_ends_at: Date | null;
  onboarding_completed_at: Date | null;
}

async function loadSessionOrganization(
  db: Pool,
  organizationId: number,
): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query<OrgSummaryRow[]>(
    'SELECT id, name, plan, trial_ends_at, onboarding_completed_at FROM organizations WHERE id = ?',
    [organizationId],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    trialEndsAt: row.trial_ends_at,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

  router.post('/login', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!deps.loginLimiter.check(`${req.ip ?? 'unknown'}|${emailRaw}`)) {
      deps.logger.warn('login rate limited', { ip: req.ip });
      throw new AppError('Too many login attempts, try again later', 429, 'rate_limited', true);
    }
    if (emailRaw === '' || password === '') {
      throw new ValidationError('Invalid input', ['email and password are required']);
    }

    let email: string;
    try {
      email = normalizeEmail(emailRaw);
    } catch {
      throw new AppError('Invalid credentials', 401, 'invalid_credentials', true);
    }

    const [rows] = await deps.db.query<UserAuthRow[]>(
      `SELECT u.id, u.email, u.password_hash, u.role, u.organization_id, u.status, o.status AS org_status
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = ?`,
      [email],
    );
    const row = rows[0];
    const storedHash = row?.password_hash ?? (await getDummyHash());
    const passwordOk = await verifyPassword(password, storedHash);

    if (row === undefined || !passwordOk) {
      await recordAudit(deps.db, deps.logger, {
        organizationId: row?.organization_id ?? null,
        userId: row?.id ?? null,
        action: 'login_failure',
        detail: 'reason=invalid_credentials',
      });
      throw new AppError('Invalid credentials', 401, 'invalid_credentials', true);
    }
    if (row.status !== 'active') {
      await recordAudit(deps.db, deps.logger, {
        organizationId: row.organization_id,
        userId: row.id,
        action: 'login_failure',
        detail: 'reason=account_disabled',
      });
      throw new AppError('Account is disabled', 403, 'account_disabled', true);
    }
    if (row.org_status === 'disabled') {
      await recordAudit(deps.db, deps.logger, {
        organizationId: row.organization_id,
        userId: row.id,
        action: 'login_failure',
        detail: 'reason=organization_disabled',
      });
      throw new AppError('Account is disabled', 403, 'account_disabled', true);
    }

    const session = await createSession(deps.db, row.id);
    await deps.db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [row.id]);
    await recordAudit(deps.db, deps.logger, {
      organizationId: row.organization_id,
      userId: row.id,
      action: 'login_success',
    });

    const user: SessionUser = {
      id: row.id,
      email: row.email,
      role: row.role,
      organizationId: row.organization_id,
    };
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(session.token, deps.secureCookies, SESSION_TTL_HOURS * 60 * 60),
    );
    const organization =
      row.organization_id === null
        ? null
        : await loadSessionOrganization(deps.db, row.organization_id);
    res.status(200).json({ user: userDto(user), organization });
  });

  router.post('/signup', async (req: Request, res: Response) => {
    const body = readJsonBody(req);

    if (!deps.loginLimiter.check(`${req.ip ?? 'unknown'}|signup`)) {
      deps.logger.warn('signup rate limited', { ip: req.ip });
      throw new AppError('Too many signup attempts, try again later', 429, 'rate_limited', true);
    }

    const clinicName = requireString(body.clinicName, 'clinicName', { min: 2, max: 120 });
    const email = normalizeEmail(body.email);
    const password = requirePassword(body.password);

    const [existing] = await deps.db.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    if (existing.length > 0) {
      throw new AppError('An account with this email already exists', 409, 'email_taken', true);
    }

    const passwordHash = await hashPassword(password);
    const [orgResult] = await deps.db.query<ResultSetHeader>(
      `INSERT INTO organizations (name, plan, trial_ends_at)
       VALUES (?, 'trial', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
      [clinicName, TRIAL_DAYS],
    );
    const organizationId = orgResult.insertId;

    let userId: number;
    try {
      const [userResult] = await deps.db.query<ResultSetHeader>(
        `INSERT INTO users (organization_id, email, password_hash, role, last_login_at)
         VALUES (?, ?, ?, 'owner', UTC_TIMESTAMP())`,
        [organizationId, email, passwordHash],
      );
      userId = userResult.insertId;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
        throw new AppError('An account with this email already exists', 409, 'email_taken', true);
      }
      throw err;
    }

    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId,
      action: 'organization_created',
      detail: `name=${clinicName} plan=trial`,
    });
    await recordAudit(deps.db, deps.logger, {
      organizationId,
      userId,
      action: 'signup_success',
      detail: 'plan=trial',
    });

    const session = await createSession(deps.db, userId);
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(session.token, deps.secureCookies, SESSION_TTL_HOURS * 60 * 60),
    );
    const organization = await loadSessionOrganization(deps.db, organizationId);
    res.status(201).json({
      user: { id: userId, email, role: 'owner', organizationId },
      organization,
    });
  });

  router.post('/logout', async (req: Request, res: Response) => {
    if (req.sessionToken !== undefined) {
      await revokeSession(deps.db, req.sessionToken);
      if (req.user !== undefined) {
        await recordAudit(deps.db, deps.logger, {
          organizationId: req.user.organizationId,
          userId: req.user.id,
          action: 'logout',
        });
      }
    }
    res.setHeader('Set-Cookie', buildClearCookie(deps.secureCookies));
    res.status(200).json({ ok: true });
  });

  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    const user = req.user as SessionUser;
    const organization =
      user.organizationId === null
        ? null
        : await loadSessionOrganization(deps.db, user.organizationId);
    res.status(200).json({ user: userDto(user), organization });
  });

  router.post('/password', requireAuth, async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = requirePassword(body.newPassword, 'newPassword');
    const user = req.user as SessionUser;

    const [rows] = await deps.db.query<PasswordHashRow[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [user.id],
    );
    const row = rows[0];
    const storedHash = row?.password_hash ?? (await getDummyHash());
    const currentOk = await verifyPassword(currentPassword, storedHash);
    if (row === undefined || !currentOk) {
      throw new AppError('Current password is incorrect', 401, 'invalid_credentials', true);
    }

    const newHash = await hashPassword(newPassword);
    await deps.db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    await revokeUserSessions(deps.db, user.id);
    await recordAudit(deps.db, deps.logger, {
      organizationId: user.organizationId,
      userId: user.id,
      action: 'password_changed',
    });
    res.setHeader('Set-Cookie', buildClearCookie(deps.secureCookies));
    res.status(200).json({ ok: true });
  });

  const forgotPasswordResponse = (res: Response): void => {
    res.status(200).json({
      message: 'If an account exists for that email, a password reset link has been sent.',
    });
  };

  router.post('/forgot-password', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const emailRaw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!deps.resetRequestLimiter.check(`${req.ip ?? 'unknown'}|${emailRaw}`)) {
      deps.logger.warn('password reset request rate limited', { ip: req.ip });
      throw new AppError('Too many reset requests, try again later', 429, 'rate_limited', true);
    }
    if (emailRaw === '') {
      throw new ValidationError('Invalid input', ['email is required']);
    }

    let email: string;
    try {
      email = normalizeEmail(emailRaw);
    } catch {
      await recordAudit(deps.db, deps.logger, {
        organizationId: null,
        userId: null,
        action: 'password_reset_requested',
        detail: 'reason=unknown_email',
      });
      forgotPasswordResponse(res);
      return;
    }

    const [rows] = await deps.db.query<UserAuthRow[]>(
      `SELECT u.id, u.email, u.organization_id, u.status, o.status AS org_status
       FROM users u
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE u.email = ?`,
      [email],
    );
    const row = rows[0];
    const ineligible = row === undefined || row.status !== 'active' || row.org_status === 'disabled';

    if (ineligible) {
      await recordAudit(deps.db, deps.logger, {
        organizationId: row?.organization_id ?? null,
        userId: row?.id ?? null,
        action: 'password_reset_requested',
        detail: 'reason=unknown_email',
      });
      forgotPasswordResponse(res);
      return;
    }

    const token = await issuePasswordResetToken(deps.db, row.id);
    const baseUrl = deps.resetBaseUrl.replace(/\/+$/, '');
    const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const delivery = await deps.resetMailer.sendPasswordReset({
      to: row.email,
      link,
      ttlMinutes: RESET_TOKEN_TTL_MINUTES,
    });
    await recordAudit(deps.db, deps.logger, {
      organizationId: row.organization_id,
      userId: row.id,
      action: 'password_reset_requested',
      detail: delivery.sent ? 'reason=delivered' : `reason=delivery_failed:${delivery.reason ?? 'unknown'}`,
    });
    forgotPasswordResponse(res);
  });

  router.post('/reset-password', async (req: Request, res: Response) => {
    const body = readJsonBody(req);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = requirePassword(body.password, 'password');

    if (!deps.resetSubmitLimiter.check(req.ip ?? 'unknown')) {
      deps.logger.warn('password reset submit rate limited', { ip: req.ip });
      throw new AppError('Too many reset attempts, try again later', 429, 'rate_limited', true);
    }
    if (token === '' || token.length > 300) {
      throw new AppError('Reset link is invalid or has expired', 400, 'invalid_reset_token', true);
    }

    const userId = await consumePasswordResetToken(deps.db, token);
    if (userId === null) {
      throw new AppError('Reset link is invalid or has expired', 400, 'invalid_reset_token', true);
    }

    const [userRows] = await deps.db.query<UserAuthRow[]>(
      'SELECT id, organization_id, status FROM users WHERE id = ?',
      [userId],
    );
    const user = userRows[0];
    if (user === undefined) {
      throw new AppError('Reset link is invalid or has expired', 400, 'invalid_reset_token', true);
    }
    if (user.status !== 'active') {
      throw new AppError('Account is disabled', 403, 'account_disabled', true);
    }

    const newHash = await hashPassword(password);
    await deps.db.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
    await revokeUserSessions(deps.db, userId);
    await recordAudit(deps.db, deps.logger, {
      organizationId: user.organization_id,
      userId,
      action: 'password_reset_completed',
    });
    res.setHeader('Set-Cookie', buildClearCookie(deps.secureCookies));
    res.status(200).json({ ok: true });
  });

  return router;
}
