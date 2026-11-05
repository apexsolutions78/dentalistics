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

    it('serves the two public plans from the saved USD price', async () => {
      await pool.query(
        "UPDATE regional_prices SET amount_minor = 4500, currency = 'USD', is_placeholder = 0 WHERE region_code = 'us'",
      );
      const res = await request(app).get('/api/public/plans');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const plans = res.body.plans as Array<Record<string, unknown>>;
      expect(plans).toHaveLength(2);

      const trial = plans.find((p) => p.id === 'trial');
      expect(trial).toMatchObject({
        name: 'Free Plan',
        priceUsdCents: 0,
        interval: 'trial',
        trialDays: 8,
      });

      const full = plans.find((p) => p.id === 'full');
      expect(full).toMatchObject({
        name: 'Full Plan',
        priceUsdCents: 4500,
        interval: 'month',
        trialDays: null,
      });
      await pool.query(
        "UPDATE regional_prices SET amount_minor = 2000, currency = 'USD', is_placeholder = 0 WHERE region_code = 'us'",
      );
    });

    it('applies a saved trial length to the landing page and the next signup only', async () => {
      const adminPassword = 'OfferAdminPassw0rd!26';
      const adminHash = await hashPassword(adminPassword);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (NULL, ?, ?, ?)',
        ['offer.admin@apextest.local', adminHash, 'admin'],
      );
      const [kept] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO organizations (name, plan, trial_ends_at)
         VALUES ('Signup Test Kept', 'trial', '2030-01-15 00:00:00')`,
      );
      const adminLogin = await request(app).post('/api/auth/login').send({
        email: 'offer.admin@apextest.local',
        password: adminPassword,
      });
      expect(adminLogin.status).toBe(200);
      const adminCookie = `sid=${sidFrom(adminLogin)}`;
      const current = await request(app).get('/api/admin/plan-offer').set('Cookie', adminCookie);
      expect(current.status).toBe(200);
      const original = current.body.offer as Record<string, unknown>;

      const ownerLogin = await request(app).post('/api/auth/login').send({
        email: duplicateEmail,
        password: signupPassword,
      });
      expect(ownerLogin.status).toBe(200);
      const denied = await request(app)
        .patch('/api/admin/plan-offer')
        .set('Cookie', `sid=${sidFrom(ownerLogin)}`)
        .send({ ...original, trialDays: 21 });
      expect(denied.status).toBe(403);

      const saved = await request(app)
        .patch('/api/admin/plan-offer')
        .set('Cookie', adminCookie)
        .send({
          ...original,
          trialDays: 21,
          trialLimitations: 'Sample limitation for the offer test.',
        });
      expect(saved.status).toBe(200);

      try {
        const plans = await request(app).get('/api/public/plans');
        expect(plans.headers['cache-control']).toBe('no-store');
        const trial = (plans.body.plans as Array<Record<string, unknown>>).find((plan) => plan.id === 'trial');
        expect(trial).toMatchObject({
          trialDays: 21,
          headline: '21-day free trial with every feature',
          limitations: 'Sample limitation for the offer test.',
        });

        const signup = await request(app).post('/api/auth/signup').send({
          clinicName: 'Signup Test Offer',
          email: 'owner.offer.signup@apextest.local',
          password: signupPassword,
        });
        expect(signup.status).toBe(201);
        const [created] = await pool.query<mysql.RowDataPacket[]>(
          `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), trial_ends_at) AS trial_secs
           FROM organizations WHERE id = ?`,
          [signup.body.user.organizationId],
        );
        expect(created[0]?.trial_secs).toBeGreaterThan(21 * 86400 - 3600);
        expect(created[0]?.trial_secs).toBeLessThan(21 * 86400 + 3600);

        const [keptRows] = await pool.query<mysql.RowDataPacket[]>(
          `SELECT DATE_FORMAT(trial_ends_at, '%Y-%m-%d %H:%i:%s') AS trial_ends_at
           FROM organizations WHERE id = ?`,
          [kept.insertId],
        );
        expect(keptRows[0]?.trial_ends_at).toBe('2030-01-15 00:00:00');
      } finally {
        await request(app).patch('/api/admin/plan-offer').set('Cookie', adminCookie).send(original);
        await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [
          'offer.admin@apextest.local',
        ]);
        await pool.query('DELETE FROM users WHERE email = ?', ['offer.admin@apextest.local']);
      }
    });

    it('signs up a clinic owner, starts the 8-day trial, and logs them in', async () => {
      const res = await request(app).post('/api/auth/signup').send({
        clinicName: 'Signup Test Dental',
        email: signupEmail,
        password: signupPassword,
      });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('owner');
      expect(res.body.user.email).toBe(signupEmail);
      expect(typeof res.body.user.organizationId).toBe('number');
      expect(res.body.organization).toMatchObject({ plan: 'trial', onboardingCompletedAt: null });
      expect(res.body.organization.trialEndsAt).not.toBeNull();
      expect(res.headers['set-cookie']).toBeDefined();

      const sid = sidFrom(res);
      const me = await request(app).get('/api/auth/me').set('Cookie', `sid=${sid}`);
      expect(me.status).toBe(200);
      expect(me.body.user.organizationId).toBe(res.body.user.organizationId);
      expect(me.body.organization.onboardingCompletedAt).toBeNull();
      expect(me.body.organization.plan).toBe('trial');

      const [orgRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT plan, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), trial_ends_at) AS trial_secs
         FROM organizations WHERE id = ?`,
        [res.body.user.organizationId],
      );
      const org = orgRows[0];
      expect(org?.plan).toBe('trial');
      expect(org?.trial_secs).toBeGreaterThan(8 * 86400 - 3600);
      expect(org?.trial_secs).toBeLessThan(8 * 86400 + 3600);

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
