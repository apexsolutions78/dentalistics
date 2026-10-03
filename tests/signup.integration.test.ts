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

describe.skipIf(testHost === undefined || testHost === '')(
  'S1a: self-serve signup and public plans',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;

    const signupEmail = 'owner.signup@apextest.local';
    const signupPassword = 'SignupPassw0rd!26x';
    const duplicateEmail = 'owner.duplicate@apextest.local';

    async function cleanup(): Promise<void> {
      await pool.query(
        `DELETE al FROM audit_logs al
         JOIN organizations o ON o.id = al.organization_id
         WHERE o.name LIKE 'Signup Test%'`,
      );
      await pool.query(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%.signup@apextest.local' OR email = 'owner.duplicate@apextest.local')",
      );
      await pool.query(
        "DELETE FROM users WHERE email LIKE '%.signup@apextest.local' OR email = 'owner.duplicate@apextest.local'",
      );
      await pool.query("DELETE FROM organizations WHERE name LIKE 'Signup Test%'");
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

      const hash = await hashPassword(signupPassword);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (NULL, ?, ?, ?)',
        [duplicateEmail, hash, 'owner'],
      );
      await pool.query("INSERT INTO organizations (name) VALUES ('Signup Test Existing')");
      const [orgRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE name = 'Signup Test Existing'",
      );
      const org = orgRows[0];
      if (org !== undefined) {
        await pool.query('UPDATE users SET organization_id = ? WHERE email = ?', [
          org.id,
          duplicateEmail,
        ]);
      }

      app = createApp({ db: pool });
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('serves the two public plans with the owner-defined pricing', async () => {
      const res = await request(app).get('/api/public/plans');
      expect(res.status).toBe(200);
      const plans = res.body.plans as Array<Record<string, unknown>>;
      expect(plans).toHaveLength(2);

      const trial = plans.find((p) => p.id === 'trial');
      expect(trial).toMatchObject({
        name: 'Free Plan',
        priceUsdCents: 0,
        interval: 'trial',
        trialDays: 7,
      });

      const full = plans.find((p) => p.id === 'full');
      expect(full).toMatchObject({
        name: 'Full Plan',
        priceUsdCents: 2000,
        interval: 'month',
        trialDays: null,
      });
    });

    it('signs up a clinic owner, starts the 7-day trial, and logs them in', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        clinicName: 'Signup Test Dental',
        email: signupEmail,
        password: signupPassword,
      });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('owner');
      expect(res.body.user.email).toBe(signupEmail);
      expect(typeof res.body.user.organizationId).toBe('number');
      expect(res.body.organization).toMatchObject({ plan: 'trial', trialDays: 7 });
      expect(res.headers['set-cookie']).toBeDefined();

      const sid = sidFrom(res);
      const me = await request(app).get('/api/auth/me').set('Cookie', `sid=${sid}`);
      expect(me.status).toBe(200);
      expect(me.body.user.organizationId).toBe(res.body.user.organizationId);

      const [orgRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT plan, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), trial_ends_at) AS trial_secs
         FROM organizations WHERE id = ?`,
        [res.body.user.organizationId],
      );
      const org = orgRows[0];
      expect(org?.plan).toBe('trial');
      expect(org?.trial_secs).toBeGreaterThan(7 * 86400 - 3600);
      expect(org?.trial_secs).toBeLessThan(7 * 86400 + 3600);

      const [userRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT role, organization_id, last_login_at FROM users WHERE email = ?`,
        [signupEmail],
      );
      expect(userRows[0]?.role).toBe('owner');
      expect(userRows[0]?.organization_id).toBe(res.body.user.organizationId);
      expect(userRows[0]?.last_login_at).not.toBeNull();

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT action FROM audit_logs WHERE organization_id = ? AND action = 'signup_success'",
        [res.body.user.organizationId],
      );
      expect(auditRows).toHaveLength(1);
    });

    it('rejects a duplicate email with 409', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        clinicName: 'Signup Test Two',
        email: duplicateEmail,
        password: signupPassword,
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('email_taken');
    });

    it('validates clinic name, email, and password', async () => {
      const shortName = await request(app).post('/api/auth/signup').send({
        clinicName: 'x',
        email: 'ok.signup@apextest.local',
        password: signupPassword,
      });
      expect(shortName.status).toBe(400);

      const badEmail = await request(app).post('/api/auth/signup').send({
        clinicName: 'Signup Test Three',
        email: 'not-an-email',
        password: signupPassword,
      });
      expect(badEmail.status).toBe(400);

      const shortPassword = await request(app).post('/api/auth/signup').send({
        clinicName: 'Signup Test Three',
        email: 'ok.signup@apextest.local',
        password: 'short',
      });
      expect(shortPassword.status).toBe(400);
    });
  },
);
