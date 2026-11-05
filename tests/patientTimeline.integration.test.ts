import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import type { DbConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { parseTimelineQuery } from '../src/services/patientTimeline';

const testHost = process.env.TEST_DB_HOST;

function testDbConfig(): DbConfig {
  const database = process.env.TEST_DB_NAME ?? 'dentalistics_test';
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

describe('timeline query parsing', () => {
  it('rejects an unknown type and clamps the page size', () => {
    expect(parseTimelineQuery({ limit: '500', offset: '-4' })).toEqual({
      types: null,
      limit: 50,
      offset: 0,
    });
    expect(() => parseTimelineQuery({ type: 'invoice,nope' })).toThrow(/Invalid timeline filter/);
  });
});

describe.skipIf(testHost === undefined || testHost === '')('patient timeline', () => {
  let pool: Pool;
  let app: Express;
  let orgId: number;
  let patientId: number;
  let ownerCookie: string;

  beforeAll(async () => {
    const cfg = testDbConfig();
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    const [org] = await pool.query<ResultSetHeader>(
      "INSERT INTO organizations (name) VALUES ('Timeline Clinic')",
    );
    orgId = org.insertId;
    const hash = await hashPassword('TimelinePassw0rd!26');
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgId, 'timeline.owner@example.test', hash, 'owner'],
    );
    const [patient] = await pool.query<ResultSetHeader>(
      `INSERT INTO patients (organization_id, first_name, last_name, phone)
       VALUES (?, 'Timeline', 'Patient', '15550007777')`,
      [orgId],
    );
    patientId = patient.insertId;
    await pool.query(
      `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time, status, service)
       VALUES (?, ?, '2026-11-01', '10:30:00', 'NO_SHOW', 'Cleaning')`,
      [orgId, patientId],
    );
    await pool.query(
      `INSERT INTO communication_messages (organization_id, channel, recipient, body, status, idempotency_key)
       VALUES (?, 'SMS', '15550007777', 'See you Thursday', 'SENT', ?)`,
      [orgId, `timeline-msg-${patientId}`],
    );
    app = createApp({ db: pool });
    const login = await request(app).post('/api/auth/login').send({
      email: 'timeline.owner@example.test',
      password: 'TimelinePassw0rd!26',
    });
    expect(login.status).toBe(200);
    ownerCookie = cookie(login);
  }, 30_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query('DELETE FROM communication_messages WHERE organization_id = ?', [orgId]);
      await pool.query('DELETE FROM appointments WHERE organization_id = ?', [orgId]);
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [
        'timeline.owner@example.test',
      ]);
      await pool.query('DELETE FROM users WHERE email = ?', ['timeline.owner@example.test']);
      await pool.query('DELETE FROM patients WHERE id = ?', [patientId]);
      await pool.query('DELETE FROM organizations WHERE id = ?', [orgId]);
      await pool.end();
    }
  });

  it('returns the visit and the message newest first, and filters by type', async () => {
    const all = await request(app)
      .get(`/api/organizations/${orgId}/patients/${patientId}/timeline`)
      .set('Cookie', ownerCookie);
    expect(all.status).toBe(200);
    const types = (all.body.items as Array<{ type: string }>).map((item) => item.type);
    expect(types).toContain('appointment');
    expect(types).toContain('message');
    const times = (all.body.items as Array<{ at: string }>).map((item) => item.at);
    expect([...times].sort((a, b) => (a < b ? 1 : -1))).toEqual(times);

    const only = await request(app)
      .get(`/api/organizations/${orgId}/patients/${patientId}/timeline?type=appointment`)
      .set('Cookie', ownerCookie);
    expect(only.body.items).toHaveLength(1);
    expect(only.body.items[0].title).toMatch(/no show/i);
    expect(only.body.items[0].href).toMatch(/^\/appointments\//);

    const bad = await request(app)
      .get(`/api/organizations/${orgId}/patients/${patientId}/timeline?type=banana`)
      .set('Cookie', ownerCookie);
    expect(bad.status).toBe(400);
  });
});
