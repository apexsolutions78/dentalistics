import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { checkDatabase, createPool } from '../src/db/pool';

const testHost = process.env.TEST_DB_HOST;

function testDbConfig(): DbConfig {
  const database = process.env.TEST_DB_NAME ?? 'dentalistics_test';
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Unsafe TEST_DB_NAME: ${database}`);
  }
  return {
    host: testHost ?? '',
    port: Number(process.env.TEST_DB_PORT ?? '3306'),
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? '',
    database,
  };
}

describe.skipIf(testHost === undefined || testHost === '')(
  'database integration',
  () => {
    let cfg: DbConfig;
    let tempDir: string;

    beforeAll(async () => {
      cfg = testDbConfig();
      const admin = mysql.createPool({
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
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dentalistics-migrations-'),
      );
    }, 30_000);

    afterAll(async () => {
      if (tempDir !== undefined) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('answers up on a healthy connection', async () => {
      const pool = createPool(cfg);
      try {
        await expect(checkDatabase(pool)).resolves.toBe('up');
      } finally {
        await pool.end();
      }
    });

    it('answers down on a bad credential connection', async () => {
      const pool = mysql.createPool({
        host: cfg.host,
        port: cfg.port,
        user: cfg.user,
        password: `${cfg.password}-wrong`,
        database: cfg.database,
      });
      try {
        await expect(checkDatabase(pool, 1500)).resolves.toBe('down');
      } finally {
        await pool.end();
      }
    });

    it('applies pending migrations once and skips them afterwards', async () => {
      const fileName = `9999_probe_${randomUUID()}.sql`;
      await fs.writeFile(
        path.join(tempDir, fileName),
        'CREATE TABLE IF NOT EXISTS t_mig_probe (id INT NOT NULL PRIMARY KEY);',
      );

      const first = await runMigrations(cfg, tempDir);
      expect(first.applied).toContain(fileName);
      expect(first.skipped).not.toContain(fileName);

      const second = await runMigrations(cfg, tempDir);
      expect(second.applied).not.toContain(fileName);
      expect(second.skipped).toContain(fileName);

      const pool = createPool(cfg);
      try {
        const [rows] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM schema_migrations WHERE name = ?',
          [fileName],
        );
        expect((rows as Array<{ cnt: number }>)[0]?.cnt).toBe(1);
        const [probe] = await pool.query(
          'SELECT COUNT(*) AS cnt FROM t_mig_probe',
        );
        expect((probe as Array<{ cnt: number }>)[0]?.cnt).toBe(0);
        await pool.query('DELETE FROM schema_migrations WHERE name = ?', [
          fileName,
        ]);
      } finally {
        await pool.end();
      }
    });

    it('applies the real project migrations from ./migrations', async () => {
      const dir = path.resolve(process.cwd(), 'migrations');
      const result = await runMigrations(cfg, dir);
      expect(result.applied.length + result.skipped.length).toBeGreaterThan(0);
      const pool = createPool(cfg);
      try {
        const [rows] = await pool.query(
          "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = 'app_meta'",
          [cfg.database],
        );
        expect((rows as Array<{ cnt: number }>)[0]?.cnt).toBe(1);
      } finally {
        await pool.end();
      }
    });
  },
);
