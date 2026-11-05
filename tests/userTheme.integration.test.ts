import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import type mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import type { DbConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';

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

function cookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  return first.split(';')[0] ?? '';
}

describe.skipIf(testHost === undefined || testHost === '')('user theme', () => {
  let pool: mysql.Pool;
  let app: Express;
  let orgId: number;
  const ownerEmail = 'theme.owner@example.test';
  const ownerPassword = 'ThemeOwnerPass1';

  beforeAll(async () => {
    const cfg = testDbConfig();
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    const [org] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, plan, trial_ends_at) VALUES ('Theme Clinic', 'full', NULL)`,
    );
    orgId = org.insertId;
    const hash = await hashPassword(ownerPassword);
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgId, ownerEmail, hash, 'owner'],
    );
    app = createApp({ db: pool });
  }, 30_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [ownerEmail]);
      await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [ownerEmail]);
      await pool.query('DELETE FROM users WHERE email = ?', [ownerEmail]);
      if (orgId !== undefined) await pool.query('DELETE FROM organizations WHERE id = ?', [orgId]);
      await pool.end();
    }
  });

  it('defaults to system and saves light, dark, or system on the signed-in user', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: ownerEmail, password: ownerPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.theme).toBe('system');
    const sid = cookie(login);

    const saved = await request(app).patch('/api/profile').set('Cookie', sid).send({ theme: 'dark' });
    expect(saved.status).toBe(200);
    expect(saved.body.user.theme).toBe('dark');

    const me = await request(app).get('/api/auth/me').set('Cookie', sid);
    expect(me.status).toBe(200);
    expect(me.body.user.theme).toBe('dark');

    const invalid = await request(app).patch('/api/profile').set('Cookie', sid).send({ theme: 'blue' });
    expect(invalid.status).toBe(400);
    const still = await request(app).get('/api/profile').set('Cookie', sid);
    expect(still.body.user.theme).toBe('dark');
  });
});
