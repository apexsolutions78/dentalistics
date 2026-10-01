import { createHash, randomBytes } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';

export const RESET_TOKEN_TTL_MINUTES = 30;
export const RESET_TOKEN_BYTES = 32;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('base64url');
}

interface TokenRow extends RowDataPacket {
  id: number;
  user_id: number;
  expires_at: Date | string;
  used_at: Date | string | null;
}

export async function issuePasswordResetToken(db: Pool, userId: number): Promise<string> {
  const token = generateResetToken();
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', [userId]);
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
    [userId, hashResetToken(token), RESET_TOKEN_TTL_MINUTES],
  );
  return token;
}

export async function consumePasswordResetToken(db: Pool, token: string): Promise<number | null> {
  const [rows] = await db.query<TokenRow[]>(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    [hashResetToken(token)],
  );
  const row = rows[0];
  if (row === undefined || row.used_at !== null) {
    return null;
  }
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }
  const [result] = await db.query(
    'UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ? AND used_at IS NULL',
    [row.id],
  );
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (affected !== 1) {
    return null;
  }
  return row.user_id;
}
