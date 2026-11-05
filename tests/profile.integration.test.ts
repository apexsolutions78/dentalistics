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

describe.skipIf(testHost === undefined || testHost === '')('account profile', () => {
  let pool: mysql.Pool;
  let app: Express;
  let orgId: number;
  const ownerEmail = 'profile.owner@example.test';
  const ownerPassword = 'OwnerProfilePass1';
  const deskEmail = 'profile.desk@example.test';
  const deskPassword = 'DeskProfilePass1';
  const adminEmail = 'profile.admin@example.test';
  const adminPassword = 'AdminProfilePass1';
  const otherEmail = 'profile.other@example.test';

  beforeAll(async () => {
    const cfg = testDbConfig();
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    const [org] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, phone, email, address, plan, trial_ends_at)
       VALUES ('Harbour View Dental', '9731000000', 'hello@harbourview.dental', '12 Marina Road', 'full', NULL)`,
    );
    orgId = org.insertId;
    async function insertUser(
      email: string,
      password: string,
      role: string,
      organizationId: number | null,
    ): Promise<void> {
      const hash = await hashPassword(password);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [organizationId, email, hash, role],
      );
    }
    await insertUser(ownerEmail, ownerPassword, 'owner', orgId);
    await insertUser(deskEmail, deskPassword, 'receptionist', orgId);
    await insertUser(adminEmail, adminPassword, 'admin', null);
    await insertUser(otherEmail, ownerPassword, 'owner', orgId);
    app = createApp({ db: pool });
  }, 30_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
        'profile.%@example.test',
      ]);
      await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
        'profile.%@example.test',
      ]);
      await pool.query('DELETE FROM users WHERE email LIKE ?', ['profile.%@example.test']);
      if (orgId !== undefined) {
        await pool.query('DELETE FROM organizations WHERE id = ?', [orgId]);
      }
      await pool.end();
    }
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookie(res);
  }

  it('requires a signed-in user', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('authentication_required');
  });

  it('lets an owner update their name, phone, and clinic contact details', async () => {
    const sid = await login(ownerEmail, ownerPassword);
    const before = await request(app).get('/api/profile').set('Cookie', sid);
    expect(before.status).toBe(200);
    expect(before.body.user.displayName).toBeNull();
    expect(before.body.clinic.name).toBe('Harbour View Dental');

    const saved = await request(app).patch('/api/profile').set('Cookie', sid).send({
      displayName: 'Avery Owner',
      phone: '+973 1234 5678',
      clinic: {
        name: 'Harbour View Studio',
        phone: '9732000000',
        email: 'studio@harbourview.dental',
        address: '14 Marina Road',
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.displayName).toBe('Avery Owner');
    expect(saved.body.user.phone).toBe('97312345678');
    expect(saved.body.clinic).toMatchObject({
      name: 'Harbour View Studio',
      phone: '9732000000',
      email: 'studio@harbourview.dental',
      address: '14 Marina Road',
    });

    const me = await request(app).get('/api/auth/me').set('Cookie', sid);
    expect(me.body.user.displayName).toBe('Avery Owner');
    expect(me.body.organization.name).toBe('Harbour View Studio');
  });

  it('requires the current password and a unique email before changing email', async () => {
    const sid = await login(ownerEmail, ownerPassword);
    const missing = await request(app).patch('/api/profile').set('Cookie', sid).send({
      email: 'owner.moved@example.test',
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.issues).toContain('currentPassword is required to change email');

    const wrong = await request(app).patch('/api/profile').set('Cookie', sid).send({
      email: 'owner.moved@example.test',
      currentPassword: 'not-the-password',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');

    const taken = await request(app).patch('/api/profile').set('Cookie', sid).send({
      email: otherEmail,
      currentPassword: ownerPassword,
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('email_taken');

    const moved = await request(app).patch('/api/profile').set('Cookie', sid).send({
      email: 'owner.moved@example.test',
      currentPassword: ownerPassword,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.user.email).toBe('owner.moved@example.test');

    const still = await request(app).get('/api/profile').set('Cookie', sid);
    expect(still.status).toBe(200);
    expect(still.body.user.email).toBe('owner.moved@example.test');

    const restored = await request(app).patch('/api/profile').set('Cookie', sid).send({
      email: ownerEmail,
      currentPassword: ownerPassword,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.user.email).toBe(ownerEmail);

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT detail FROM audit_logs WHERE action = ? ORDER BY id DESC LIMIT 1',
      ['profile_updated'],
    );
    expect(String(rows[0]?.detail)).not.toContain(ownerPassword);
  });

  it('lets staff change only their own details', async () => {
    const sid = await login(deskEmail, deskPassword);
    const view = await request(app).get('/api/profile').set('Cookie', sid);
    expect(view.status).toBe(200);
    expect(view.body.clinic).toBeNull();

    const denied = await request(app).patch('/api/profile').set('Cookie', sid).send({
      displayName: 'Dana Desk',
      clinic: { name: 'Taken Over' },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');

    const [orgRows] = await pool.query<mysql.RowDataPacket[]>('SELECT name FROM organizations WHERE id = ?', [orgId]);
    expect(orgRows[0]?.name).not.toBe('Taken Over');

    const saved = await request(app).patch('/api/profile').set('Cookie', sid).send({
      displayName: 'Dana Desk',
      phone: '',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.displayName).toBe('Dana Desk');
    expect(saved.body.user.phone).toBeNull();
    expect(saved.body.clinic).toBeNull();
  });

  it('lets a platform administrator edit their own account and not a clinic', async () => {
    const sid = await login(adminEmail, adminPassword);
    const view = await request(app).get('/api/profile').set('Cookie', sid);
    expect(view.body.user.organizationId).toBeNull();
    expect(view.body.clinic).toBeNull();

    const denied = await request(app).patch('/api/profile').set('Cookie', sid).send({
      clinic: { name: 'Platform clinic' },
    });
    expect(denied.status).toBe(403);

    const saved = await request(app).patch('/api/profile').set('Cookie', sid).send({
      displayName: ' ',
      phone: null,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.user.displayName).toBeNull();
  });

  it('keeps clinic details unchanged when the clinic is read-only, and still saves the person', async () => {
    await pool.query(
      `UPDATE organizations SET plan = 'trial', trial_ends_at = '2000-01-01 00:00:00' WHERE id = ?`,
      [orgId],
    );
    const sid = await login(ownerEmail, ownerPassword);
    const locked = await request(app).patch('/api/profile').set('Cookie', sid).send({
      clinic: { name: 'Should Not Save' },
    });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('trial_expired');

    const personal = await request(app).patch('/api/profile').set('Cookie', sid).send({
      displayName: 'Avery Still Here',
    });
    expect(personal.status).toBe(200);
    expect(personal.body.user.displayName).toBe('Avery Still Here');
    const [orgRows] = await pool.query<mysql.RowDataPacket[]>('SELECT name FROM organizations WHERE id = ?', [orgId]);
    expect(orgRows[0]?.name).toBe('Harbour View Studio');
  });

  it('rejects an unknown field and a phone that is not digits', async () => {
    const sid = await login(deskEmail, deskPassword);
    const unknown = await request(app).patch('/api/profile').set('Cookie', sid).send({ role: 'owner' });
    expect(unknown.status).toBe(400);
    const phone = await request(app).patch('/api/profile').set('Cookie', sid).send({ phone: 'call me' });
    expect(phone.status).toBe(400);
    expect(phone.body.error.code).toBe('validation_failed');
  });
});
