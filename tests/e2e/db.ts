import 'dotenv/config';
import { createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import type { DbConfig } from '../../src/config';

export function testDbConfig(): DbConfig {
  const host = process.env.TEST_DB_HOST;
  if (host === undefined || host === '') {
    throw new Error('TEST_DB_HOST is required in .env to run E2E tests');
  }
  const database = process.env.TEST_DB_NAME ?? 'dentalistics_test';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe TEST_DB_NAME: ${database}`);
  }
  return {
    host,
    port: Number(process.env.TEST_DB_PORT ?? '3306'),
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? '',
    database,
  };
}

export function createTestPool(cfg: DbConfig): Pool {
  return createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  });
}
