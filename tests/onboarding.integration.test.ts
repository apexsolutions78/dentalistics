import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
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

function sidFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  const pair = first.split(';')[0] ?? '';
  const eq = pair.indexOf('=');
  return decodeURIComponent(pair.slice(eq + 1));
}

function cookie(res: request.Response): string {
  return `sid=${sidFrom(res)}`;
}

describe.skipIf(testHost === undefined || testHost === '')(
  'S1e: clinic onboarding completion',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;

    const ownerEmail = 'owner.onboarding@apextest.local';
    const ownerPassword = 'OnboardPassw0rd!26x';
    const recvEmail = 'receptionist.onboarding@apextest.local';
    const recvPassword = 'ReceptionOnboard!26x';
    const orgName = 'Onboarding Test Clinic';
    let orgId: number;

    async function cleanup(): Promise<void> {
      await pool.query(
        `DELETE al FROM audit_logs al
         JOIN organizations o ON o.id = al.organization_id
         WHERE o.name = ?`,
        [orgName],
      );
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
        '%.onboarding@apextest.local',
      ]);
      await pool.query('DELETE FROM users WHERE email LIKE ?', ['%.onboarding@apextest.local']);
      await pool.query('DELETE FROM organizations WHERE name = ?', [orgName]);
    }

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

      const migrationResult = await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
      expect(migrationResult.applied.length + migrationResult.skipped.length).toBeGreaterThan(0);

      pool = createPool(cfg);
      await cleanup();

      const [orgRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        [orgName],
      );
      orgId = orgRow.insertId;

      async function insertUser(email: string, password: string, role: string): Promise<void> {
        const hash = await hashPassword(password);
        await pool.query(
          'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [orgId, email, hash, role],
        );
      }
      await insertUser(ownerEmail, ownerPassword, 'owner');
      await insertUser(recvEmail, recvPassword, 'receptionist');

      app = createApp({ db: pool });
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('reports an incomplete onboarding state to the owner session', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      expect(login.status).toBe(200);
      expect(login.body.organization).toMatchObject({ name: orgName, plan: 'full' });
      expect(login.body.organization.onboardingCompletedAt).toBeNull();

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie(login));
      expect(me.status).toBe(200);
      expect(me.body.organization.onboardingCompletedAt).toBeNull();
      expect(me.body.organization.id).toBe(orgId);
    });

    it('lets the owner save clinic profile while onboarding is incomplete', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      const res = await request(app)
        .patch(`/api/organizations/${orgId}/settings/clinic`)
        .set('Cookie', cookie(login))
        .send({ name: orgName, phone: '97312345678', address: '123 Main St' });
      expect(res.status).toBe(200);
      expect(res.body.settings.clinic.name).toBe(orgName);
      expect(res.body.settings.clinic.phone).toBe('97312345678');
    });

    it('completes onboarding, audits it once, and persists the state', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      const res = await request(app)
        .post(`/api/organizations/${orgId}/onboarding/complete`)
        .set('Cookie', cookie(login));
      expect(res.status).toBe(200);
      expect(res.body.organization.onboardingCompletedAt).not.toBeNull();

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE organization_id = ? AND action = 'onboarding_completed'",
        [orgId],
      );
      expect(auditRows[0]?.cnt).toBe(1);
    });

    it('is idempotent on a second completion call', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      const res = await request(app)
        .post(`/api/organizations/${orgId}/onboarding/complete`)
        .set('Cookie', cookie(login));
      expect(res.status).toBe(200);
      expect(res.body.organization.onboardingCompletedAt).not.toBeNull();

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE organization_id = ? AND action = 'onboarding_completed'",
        [orgId],
      );
      expect(auditRows[0]?.cnt).toBe(1);
    });

    it('reports the completed state on the next login and /me', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      expect(login.body.organization.onboardingCompletedAt).not.toBeNull();

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie(login));
      expect(me.body.organization.onboardingCompletedAt).not.toBeNull();
      expect(me.body.organization.plan).toBe('full');
      expect(me.body.organization.trialEndsAt === null || typeof me.body.organization.trialEndsAt === 'string').toBe(
        true,
      );
    });

    it('forbids a receptionist from completing onboarding', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: recvEmail, password: recvPassword });
      expect(login.status).toBe(200);
      const res = await request(app)
        .post(`/api/organizations/${orgId}/onboarding/complete`)
        .set('Cookie', cookie(login));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('returns plan and onboarding fields from GET /:orgId', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      const res = await request(app)
        .get(`/api/organizations/${orgId}`)
        .set('Cookie', cookie(login));
      expect(res.status).toBe(200);
      expect(res.body.organization.plan).toBe('full');
      expect(res.body.organization.onboardingCompletedAt).not.toBeNull();
      expect(res.body.organization).toHaveProperty('trialEndsAt');
    });
  },
);
