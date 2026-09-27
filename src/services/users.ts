import type { Pool } from 'mysql2/promise';
import { hashPassword } from '../auth/password';
import { AppError } from '../errors';
import { recordAudit } from '../audit';
import type { Logger } from '../logger';
import { normalizeEmail, requirePassword, requireRole } from '../validate';

export interface CreatedUser {
  id: number;
  email: string;
  role: string;
  organizationId: number;
  status: string;
}

export const CLINIC_ROLES = ['owner', 'receptionist'] as const;

export async function createUserInOrg(
  db: Pool,
  logger: Logger,
  organizationId: number,
  input: unknown,
  actorId: number,
): Promise<CreatedUser> {
  if (input === null || typeof input !== 'object') {
    throw new AppError('Invalid input', 400, 'validation_failed', true);
  }
  const body = input as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const password = requirePassword(body.password);
  const role = requireRole(body.role, CLINIC_ROLES);
  const passwordHash = await hashPassword(password);

  try {
    const [result] = await db.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [organizationId, email, passwordHash, role],
    );
    const userId = (result as { insertId: number }).insertId;
    await recordAudit(db, logger, {
      organizationId,
      userId: actorId,
      action: 'user_created',
      detail: `email=${email} role=${role}`,
    });
    return { id: userId, email, role, organizationId, status: 'active' };
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ER_DUP_ENTRY') {
      throw new AppError('Email already exists', 409, 'email_already_exists', true);
    }
    throw err;
  }
}
