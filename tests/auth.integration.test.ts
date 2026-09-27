import 'dotenv/config';
import { createHash } from 'node:crypto';
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
  'M2 acceptance: authentication and multi-tenancy',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let secureApp: Express;
    let rlApp: Express;

    const adminEmail = 'admin@apextest.local';
    const adminPassword = 'AdminSeedPassw0rd!26';
    const ownerAEmail = 'owner.a@apextest.local';
    const ownerAPassword = 'OwnerAPassw0rd!26x';
    const recvAEmail = 'receptionist.a@apextest.local';
    const recvAPassword = 'ReceptionAPassw0rd!26x';
    const ownerBEmail = 'owner.b@apextest.local';
    const ownerBPassword = 'OwnerBPassw0rd!26x';

    let orgAId: number;
    let orgBId: number;
    let ownerAId: number;
    let ownerBId: number;

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
      await pool.query('DELETE FROM sessions');
      await pool.query('DELETE FROM audit_logs');
      await pool.query('DELETE FROM users');
      await pool.query('DELETE FROM organizations');

      const [orgARow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['Clinic A'],
      );
      orgAId = orgARow.insertId;
      const [orgBRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['Clinic B'],
      );
      orgBId = orgBRow.insertId;

      async function insertUser(
        email: string,
        password: string,
        role: string,
        organizationId: number | null,
      ): Promise<number> {
        const hash = await hashPassword(password);
        const [row] = await pool.query<mysql.ResultSetHeader>(
          'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [organizationId, email, hash, role],
        );
        return row.insertId;
      }

      await insertUser(adminEmail, adminPassword, 'admin', null);
      ownerAId = await insertUser(ownerAEmail, ownerAPassword, 'owner', orgAId);
      await insertUser(recvAEmail, recvAPassword, 'receptionist', orgAId);
      ownerBId = await insertUser(ownerBEmail, ownerBPassword, 'owner', orgBId);

      app = createApp({ db: pool });
      secureApp = createApp({ db: pool, secureCookies: true });
      rlApp = createApp({ db: pool });
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('rejects login with missing fields as validation error', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('validation_failed');
      expect(Array.isArray(res.body.error.issues)).toBe(true);
    });

    it('rejects a wrong password with a generic 401 and no hash leak', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: 'WrongPassword!2026x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
      expect(res.text).not.toContain('scrypt$');
    });

    it('returns the same generic 401 for an unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ghost@apextest.local', password: 'WhateverPassword!26x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('logs in an active user and exposes /me only with a valid cookie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(ownerAEmail);
      expect(res.body.user.role).toBe('owner');
      expect(res.body.user.organizationId).toBe(orgAId);
      expect(res.text).not.toContain('scrypt$');

      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('SameSite=Lax');
      expect(cookieStr).toContain('Path=/');
      expect(cookieStr).toContain('Max-Age=43200');
      expect(cookieStr).not.toContain('Secure');

      const me = await request(app).get('/api/auth/me').set('Cookie', cookie(res));
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe(ownerAEmail);

      const anon = await request(app).get('/api/auth/me');
      expect(anon.status).toBe(401);
      expect(anon.body.error.code).toBe('authentication_required');
    });

    it('rejects garbage and expired session cookies', async () => {
      const garbage = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'sid=not-a-real-token');
      expect(garbage.status).toBe(401);

      const expiredToken = 'expired-test-token';
      const tokenHash = createHash('sha256').update(expiredToken).digest('hex');
      await pool.query(
        'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        [tokenHash, ownerAId, new Date(Date.now() - 60_000)],
      );
      const expired = await request(app)
        .get('/api/auth/me')
        .set('Cookie', `sid=${expiredToken}`);
      expect(expired.status).toBe(401);
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS cnt FROM sessions WHERE token_hash = ?',
        [tokenHash],
      );
      expect(rows[0]?.cnt).toBe(0);
    });

    it('logout revokes the session', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: recvAEmail, password: recvAPassword });
      expect(login.status).toBe(200);
      const c = cookie(login);

      const out = await request(app).post('/api/auth/logout').set('Cookie', c);
      expect(out.status).toBe(200);
      expect(out.body.ok).toBe(true);
      const cleared = String(out.headers['set-cookie'] ?? '');
      expect(cleared).toContain('Max-Age=0');

      const me = await request(app).get('/api/auth/me').set('Cookie', c);
      expect(me.status).toBe(401);
    });

    it('prevents Clinic A accounts from reading Clinic B data (tenant isolation)', async () => {
      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      const cookieA = cookie(loginA);
      const loginB = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: ownerBPassword });
      const cookieB = cookie(loginB);

      const ownOrg = await request(app)
        .get(`/api/organizations/${orgAId}`)
        .set('Cookie', cookieA);
      expect(ownOrg.status).toBe(200);
      expect(ownOrg.body.organization.name).toBe('Clinic A');

      const foreignOrg = await request(app)
        .get(`/api/organizations/${orgBId}`)
        .set('Cookie', cookieA);
      expect(foreignOrg.status).toBe(404);

      const foreignUsers = await request(app)
        .get(`/api/organizations/${orgBId}/users`)
        .set('Cookie', cookieA);
      expect(foreignUsers.status).toBe(404);

      const mirroredForeign = await request(app)
        .get(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieB);
      expect(mirroredForeign.status).toBe(404);

      const ownUsers = await request(app)
        .get(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA);
      expect(ownUsers.status).toBe(200);
      const emails = (ownUsers.body.users as Array<{ email: string }>).map((u) => u.email);
      expect(emails.sort()).toEqual([ownerAEmail, recvAEmail].sort());
      expect(ownUsers.text).not.toContain('password');
      expect(ownUsers.text).not.toContain('scrypt$');
    });

    it('enforces role restrictions for receptionists and non-admin owners', async () => {
      const recvLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: recvAEmail, password: recvAPassword });
      const recvCookie = cookie(recvLogin);

      const listForbidden = await request(app)
        .get(`/api/organizations/${orgAId}/users`)
        .set('Cookie', recvCookie);
      expect(listForbidden.status).toBe(403);
      expect(listForbidden.body.error.code).toBe('forbidden');

      const createForbidden = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', recvCookie)
        .send({ email: 'x@apextest.local', password: 'SomePassword!2026', role: 'receptionist' });
      expect(createForbidden.status).toBe(403);

      const adminForbidden = await request(app)
        .post('/api/admin/organizations')
        .set('Cookie', recvCookie)
        .send({ name: 'Clinic R' });
      expect(adminForbidden.status).toBe(403);

      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      const cookieA = cookie(loginA);
      const ownerNotAdmin = await request(app)
        .post('/api/admin/organizations')
        .set('Cookie', cookieA)
        .send({ name: 'Clinic R' });
      expect(ownerNotAdmin.status).toBe(403);

      const ownerManages = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA)
        .send({
          email: 'receptionist.b@apextest.local',
          password: 'ReceptionBPassw0rd!26x',
          role: 'receptionist',
        });
      expect(ownerManages.status).toBe(201);
      expect(ownerManages.body.user.role).toBe('receptionist');
    }, 20_000);

    it('lets the platform admin manage organizations and users', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.organizationId).toBeNull();
      const adminCookie = cookie(login);

      const created = await request(app)
        .post('/api/admin/organizations')
        .set('Cookie', adminCookie)
        .send({ name: 'Clinic C' });
      expect(created.status).toBe(201);
      const orgCId: number = created.body.organization.id;
      expect(created.body.organization.name).toBe('Clinic C');

      const listed = await request(app)
        .get('/api/admin/organizations')
        .set('Cookie', adminCookie);
      expect(listed.status).toBe(200);
      const names = (listed.body.organizations as Array<{ name: string }>).map((o) => o.name);
      expect(names).toContain('Clinic A');
      expect(names).toContain('Clinic B');
      expect(names).toContain('Clinic C');

      const ownerC = await request(app)
        .post(`/api/admin/organizations/${orgCId}/users`)
        .set('Cookie', adminCookie)
        .send({ email: 'owner.c@apextest.local', password: 'OwnerCPassw0rd!26x', role: 'owner' });
      expect(ownerC.status).toBe(201);

      const ownerCLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'owner.c@apextest.local', password: 'OwnerCPassw0rd!26x' });
      expect(ownerCLogin.status).toBe(200);
      const ownerCOrg = await request(app)
        .get(`/api/organizations/${orgCId}`)
        .set('Cookie', cookie(ownerCLogin));
      expect(ownerCOrg.status).toBe(200);
      expect(ownerCOrg.body.organization.name).toBe('Clinic C');

      const adminSeesAny = await request(app)
        .get(`/api/organizations/${orgAId}`)
        .set('Cookie', adminCookie);
      expect(adminSeesAny.status).toBe(200);

      const adminCannotMintAdmin = await request(app)
        .post(`/api/admin/organizations/${orgAId}/users`)
        .set('Cookie', adminCookie)
        .send({ email: 'sneaky@apextest.local', password: 'SneakyPassword!26', role: 'admin' });
      expect(adminCannotMintAdmin.status).toBe(400);
      expect(adminCannotMintAdmin.body.error.code).toBe('validation_failed');
    }, 25_000);

    it('blocks cross-org user actions and self-disable', async () => {
      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      const cookieA = cookie(loginA);

      const crossOrg = await request(app)
        .delete(`/api/organizations/${orgAId}/users/${ownerBId}`)
        .set('Cookie', cookieA);
      expect(crossOrg.status).toBe(404);

      const selfDisable = await request(app)
        .delete(`/api/organizations/${orgAId}/users/${ownerAId}`)
        .set('Cookie', cookieA);
      expect(selfDisable.status).toBe(400);
      expect(selfDisable.body.error.code).toBe('cannot_disable_self');
    });

    it('disable revokes sessions and blocks new logins', async () => {
      const recBLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'receptionist.b@apextest.local', password: 'ReceptionBPassw0rd!26x' });
      expect(recBLogin.status).toBe(200);
      const recBCookie = cookie(recBLogin);
      const recBId: number = recBLogin.body.user.id;

      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      const disabled = await request(app)
        .delete(`/api/organizations/${orgAId}/users/${recBId}`)
        .set('Cookie', cookie(loginA));
      expect(disabled.status).toBe(200);

      const meAfter = await request(app).get('/api/auth/me').set('Cookie', recBCookie);
      expect(meAfter.status).toBe(401);

      const loginAfter = await request(app)
        .post('/api/auth/login')
        .send({ email: 'receptionist.b@apextest.local', password: 'ReceptionBPassw0rd!26x' });
      expect(loginAfter.status).toBe(403);
      expect(loginAfter.body.error.code).toBe('account_disabled');
    }, 20_000);

    it('supports self password change with session invalidation', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: ownerBPassword });
      expect(login.status).toBe(200);
      const c = cookie(login);

      const wrongCurrent = await request(app)
        .post('/api/auth/password')
        .set('Cookie', c)
        .send({ currentPassword: 'NotThePassword!26x', newPassword: 'NextOwnerPassw0rd!26x' });
      expect(wrongCurrent.status).toBe(401);
      expect(wrongCurrent.body.error.code).toBe('invalid_credentials');

      const changed = await request(app)
        .post('/api/auth/password')
        .set('Cookie', c)
        .send({ currentPassword: ownerBPassword, newPassword: 'NextOwnerPassw0rd!26x' });
      expect(changed.status).toBe(200);

      const meAfter = await request(app).get('/api/auth/me').set('Cookie', c);
      expect(meAfter.status).toBe(401);

      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: ownerBPassword });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: 'NextOwnerPassw0rd!26x' });
      expect(newLogin.status).toBe(200);
    }, 25_000);

    it('admin password reset revokes sessions and requires the new password', async () => {
      const victimLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: 'NextOwnerPassw0rd!26x' });
      expect(victimLogin.status).toBe(200);
      const victimCookie = cookie(victimLogin);

      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      const adminCookie = cookie(adminLogin);

      const reset = await request(app)
        .post(`/api/admin/users/${ownerBId}/password`)
        .set('Cookie', adminCookie)
        .send({ newPassword: 'ResetOwnerPassw0rd!26x' });
      expect(reset.status).toBe(200);

      const meAfter = await request(app).get('/api/auth/me').set('Cookie', victimCookie);
      expect(meAfter.status).toBe(401);

      const resetLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: 'ResetOwnerPassw0rd!26x' });
      expect(resetLogin.status).toBe(200);
    }, 25_000);

    it('rejects duplicate emails with 409 and invalid input with 400', async () => {
      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      const cookieA = cookie(loginA);

      const duplicate = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA)
        .send({ email: ownerAEmail, password: 'SomePassword!2026', role: 'owner' });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('email_already_exists');

      const badEmail = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA)
        .send({ email: 'not-an-email', password: 'SomePassword!2026', role: 'owner' });
      expect(badEmail.status).toBe(400);

      const shortPassword = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA)
        .send({ email: 'new@apextest.local', password: 'short', role: 'owner' });
      expect(shortPassword.status).toBe(400);
      expect(shortPassword.body.error.code).toBe('validation_failed');

      const badRole = await request(app)
        .post(`/api/organizations/${orgAId}/users`)
        .set('Cookie', cookieA)
        .send({ email: 'new2@apextest.local', password: 'SomePassword!2026', role: 'admin' });
      expect(badRole.status).toBe(400);
    }, 25_000);

    it('rate limits repeated failed logins', async () => {
      const attempts: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await request(rlApp)
          .post('/api/auth/login')
          .send({ email: 'rate.limit@apextest.local', password: 'WrongPassword!2026x' });
        attempts.push(res.status);
      }
      expect(attempts.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(attempts[10]).toBe(429);

      const last = await request(rlApp)
        .post('/api/auth/login')
        .send({ email: 'rate.limit@apextest.local', password: 'WrongPassword!2026x' });
      expect(last.body.error.code).toBe('rate_limited');
    }, 30_000);

    it('sets the Secure cookie flag when secureCookies is enabled', async () => {
      const res = await request(secureApp)
        .post('/api/auth/login')
        .send({ email: adminEmail, password: adminPassword });
      expect(res.status).toBe(200);
      const setCookie = res.headers['set-cookie'];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
      expect(cookieStr).toContain('Secure');
      expect(cookieStr).toContain('HttpOnly');
    });

    it('blocks login when the organization is disabled', async () => {
      await pool.query('UPDATE organizations SET status = ? WHERE id = ?', ['disabled', orgAId]);
      try {
        const res = await request(app)
          .post('/api/auth/login')
          .send({ email: ownerAEmail, password: ownerAPassword });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('account_disabled');
      } finally {
        await pool.query('UPDATE organizations SET status = ? WHERE id = ?', ['active', orgAId]);
      }
    });

    it('writes audit rows for authentication events', async () => {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS cnt FROM audit_logs WHERE action IN ('login_success', 'login_failure', 'logout', 'password_changed', 'user_created', 'organization_created')",
      );
      expect(rows[0]?.cnt).toBeGreaterThan(0);
    });
  },
);
