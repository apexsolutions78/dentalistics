import type { RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../auth/password';
import { revokeUserSessions } from '../auth/sessions';
import { ConfigError, loadEnv } from '../config';
import { createLogger } from '../logger';
import { createPool } from './pool';
import { normalizeEmail, requirePassword } from '../validate';

interface AdminUserRow extends RowDataPacket {
  id: number;
}

async function runSeed(): Promise<void> {
  const config = loadEnv();
  const logger = createLogger({ level: config.logLevel });

  const rawEmail = process.env.ADMIN_EMAIL;
  const rawPassword = process.env.ADMIN_PASSWORD;
  const issues: string[] = [];
  if (rawEmail === undefined || rawEmail === '') {
    issues.push('ADMIN_EMAIL is required');
  }
  if (rawPassword === undefined) {
    issues.push('ADMIN_PASSWORD is required');
  }
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  const email = normalizeEmail(rawEmail);
  const password = requirePassword(rawPassword, 'ADMIN_PASSWORD');
  const passwordHash = await hashPassword(password);

  const pool = createPool(config.db);
  try {
    const [rows] = await pool.query<AdminUserRow[]>('SELECT id FROM users WHERE email = ?', [email]);
    const existing = rows[0];
    let created = false;
    if (existing === undefined) {
      await pool.query(
        "INSERT INTO users (organization_id, email, password_hash, role) VALUES (NULL, ?, ?, 'admin')",
        [email, passwordHash],
      );
      created = true;
    } else {
      await pool.query(
        "UPDATE users SET password_hash = ?, role = 'admin', status = 'active' WHERE id = ?",
        [passwordHash, existing.id],
      );
      await revokeUserSessions(pool, existing.id);
    }
    logger.info('admin seed complete', { email, created, sessionsRevoked: !created });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runSeed().then(
    () => process.exit(0),
    (err: unknown) => {
      if (err instanceof ConfigError || err instanceof Error) {
        process.stderr.write(`${err.message}\n`);
      } else {
        process.stderr.write(`${String(err)}\n`);
      }
      process.exit(1);
    },
  );
}
