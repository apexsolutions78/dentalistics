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

function firstId(rows: mysql.RowDataPacket[]): number {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected exactly one row');
  }
  return Number(row.id);
}

function firstCount(rows: mysql.RowDataPacket[]): number {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected a count row');
  }
  return Number(row.n);
}

describe.skipIf(testHost === undefined || testHost === '')(
  'S1c: day-9 read-only lock and platform-admin activation',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;

    const adminEmail = 'admin.triallock@apextest.local';
    const adminPassword = 'TrialAdminPassw0rd!26';
    const ownerEmail = 'owner.triallock@apextest.local';
    const ownerPassword = 'TrialOwnerPassw0rd!26';
    const fullOwnerEmail = 'owner.trialfull@apextest.local';
    const fullOwnerPassword = 'TrialFullPassw0rd!26';

    const clinicName = 'Trial Lock Clinic';
    const fullClinicName = 'Trial Lock Full Clinic';

    let orgId: number;
    let fullOrgId: number;
    let ownerSid: string;
    let adminSid: string;
    let fullOwnerSid: string;

    async function cleanup(): Promise<void> {
      await pool.query(
        `DELETE al FROM audit_logs al
         JOIN organizations o ON o.id = al.organization_id
         WHERE o.name LIKE 'Trial Lock%'`,
      );
      await pool.query(
        `DELETE FROM sessions WHERE user_id IN (
           SELECT id FROM users WHERE email IN (?, ?, ?))`,
        [adminEmail, ownerEmail, fullOwnerEmail],
      );
      await pool.query(
        'DELETE FROM users WHERE email IN (?, ?, ?)',
        [adminEmail, ownerEmail, fullOwnerEmail],
      );
      await pool.query("DELETE FROM organizations WHERE name LIKE 'Trial Lock%'");
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

      const adminHash = await hashPassword(adminPassword);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (NULL, ?, ?, ?)',
        [adminEmail, adminHash, 'admin'],
      );

      const fullHash = await hashPassword(fullOwnerPassword);
      await pool.query("INSERT INTO organizations (name) VALUES (?)", [fullClinicName]);
      const [fullRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE name = ?',
        [fullClinicName],
      );
      fullOrgId = firstId(fullRows);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [fullOrgId, fullOwnerEmail, fullHash, 'owner'],
      );

      app = createApp({ db: pool });
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('starts a self-serve signup on an active trial that can write', async () => {
      const signup = await request(app).post('/api/auth/signup').send({
        clinicName,
        email: ownerEmail,
        password: ownerPassword,
      });
      expect(signup.status).toBe(201);
      ownerSid = cookie(signup);

      const [orgRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE name = ?',
        [clinicName],
      );
      orgId = firstId(orgRows);

      const res = await request(app)
        .patch(`/api/organizations/${orgId}/settings/clinic`)
        .set('Cookie', ownerSid)
        .send({ name: clinicName, phone: '97312345678' });
      expect(res.status).toBe(200);
    });

    it('blocks writes but allows reads after the trial expires', async () => {
      await pool.query(
        'UPDATE organizations SET trial_ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) WHERE id = ?',
        [orgId],
      );

      const read = await request(app)
        .get(`/api/organizations/${orgId}/settings`)
        .set('Cookie', ownerSid);
      expect(read.status).toBe(200);

      const write = await request(app)
        .patch(`/api/organizations/${orgId}/settings/clinic`)
        .set('Cookie', ownerSid)
        .send({ name: 'Should Not Save' });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('trial_expired');

      const lead = await request(app)
        .post(`/api/organizations/${orgId}/leads`)
        .set('Cookie', ownerSid)
        .send({ name: 'Blocked Lead', phone: '+15550990001' });
      expect(lead.status).toBe(403);
      expect(lead.body.error.code).toBe('trial_expired');
    });

    it('keeps authentication flows usable while locked', async () => {
      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', ownerSid);
      expect(logout.status).toBe(200);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      expect(login.status).toBe(200);
      ownerSid = cookie(login);

      const me = await request(app).get('/api/auth/me').set('Cookie', ownerSid);
      expect(me.status).toBe(200);
      expect(me.body.organization.plan).toBe('trial');
    });

    it('lists the expired trial for platform admins only', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      expect(login.status).toBe(200);
      adminSid = cookie(login);

      const trials = await request(app)
        .get('/api/admin/trials')
        .set('Cookie', adminSid);
      expect(trials.status).toBe(200);
      const list = trials.body.trials as Array<Record<string, unknown>>;
      const target = list.find((row) => row.id === orgId);
      expect(target).toBeDefined();
      expect(target?.name).toBe(clinicName);

      const denied = await request(app)
        .get('/api/admin/trials')
        .set('Cookie', ownerSid);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('forbidden');
    });

    it('activates the trial from the platform admin and lifts the lock', async () => {
      const res = await request(app)
        .post(`/api/admin/organizations/${orgId}/activate`)
        .set('Cookie', adminSid);
      expect(res.status).toBe(200);
      expect(res.body.activated).toBe(true);
      expect(res.body.organization.plan).toBe('full');

      const write = await request(app)
        .patch(`/api/organizations/${orgId}/settings/clinic`)
        .set('Cookie', ownerSid)
        .send({ name: clinicName, phone: '97312345678' });
      expect(write.status).toBe(200);

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'trial_activated'",
        [orgId],
      );
      expect(firstCount(auditRows)).toBe(1);

      const trials = await request(app)
        .get('/api/admin/trials')
        .set('Cookie', adminSid);
      const list = trials.body.trials as Array<Record<string, unknown>>;
      expect(list.find((row) => row.id === orgId)).toBeUndefined();

      const repeat = await request(app)
        .post(`/api/admin/organizations/${orgId}/activate`)
        .set('Cookie', adminSid);
      expect(repeat.status).toBe(200);
      expect(repeat.body.activated).toBe(false);

      const [auditAfter] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'trial_activated'",
        [orgId],
      );
      expect(firstCount(auditAfter)).toBe(1);
    });

    it('refuses activation to clinic accounts', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: fullOwnerEmail, password: fullOwnerPassword });
      expect(login.status).toBe(200);
      fullOwnerSid = cookie(login);

      const res = await request(app)
        .post(`/api/admin/organizations/${fullOrgId}/activate`)
        .set('Cookie', fullOwnerSid);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('never locks a full-plan clinic', async () => {
      const write = await request(app)
        .patch(`/api/organizations/${fullOrgId}/settings/clinic`)
        .set('Cookie', fullOwnerSid)
        .send({ name: fullClinicName, phone: '97312345679' });
      expect(write.status).toBe(200);
    });
  },
);
