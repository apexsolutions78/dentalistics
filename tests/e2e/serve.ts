import 'dotenv/config';
import path from 'node:path';
import { createPool } from 'mysql2/promise';
import type { DbConfig } from '../../src/config';
import { runMigrations } from '../../src/db/migrate';
import { testDbConfig } from './db';

async function ensureSchema(cfg: DbConfig): Promise<void> {
  const admin = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``);
  } finally {
    await admin.end();
  }
  const result = await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
  console.log(`[e2e serve] migrations applied=${result.applied.length} skipped=${result.skipped.length}`);
}

async function main(): Promise<void> {
  const cfg = testDbConfig();
  await ensureSchema(cfg);

  process.env.DB_HOST = cfg.host;
  process.env.DB_PORT = String(cfg.port);
  process.env.DB_USER = cfg.user;
  process.env.DB_PASSWORD = cfg.password;
  process.env.DB_NAME = cfg.database;
  process.env.PORT = process.env.PORT ?? process.env.E2E_PORT ?? '3799';
  process.env.REMINDER_TICK_MS = process.env.REMINDER_TICK_MS ?? '0';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

  await import('../../src/index.js');
}

void main().catch((err: unknown) => {
  console.error('[e2e serve] failed to start:', err);
  process.exit(1);
});
