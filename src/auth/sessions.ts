import { createHash, randomBytes } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SESSION_TTL_HOURS } from '../http/cookies';

export interface SessionUser {
  id: number;
  email: string;
  role: 'owner' | 'receptionist' | 'admin';
  organizationId: number | null;
}

interface SessionRow extends RowDataPacket {
  user_id: number;
  email: string;
  role: SessionUser['role'];
  organization_id: number | null;
  user_status: 'active' | 'disabled';
  expires_at: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Pool, userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export async function getSessionUser(db: Pool, token: string): Promise<SessionUser | null> {
  if (token.length === 0 || token.length > 512) {
    return null;
  }
  const [rows] = await db.query<SessionRow[]>(
    `SELECT s.user_id, s.expires_at, u.email, u.role, u.organization_id, u.status AS user_status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await db.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    return null;
  }
  if (row.user_status !== 'active') {
    return null;
  }
  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    organizationId: row.organization_id,
  };
}

export async function revokeSession(db: Pool, token: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export async function revokeUserSessions(db: Pool, userId: number): Promise<void> {
  await db.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
