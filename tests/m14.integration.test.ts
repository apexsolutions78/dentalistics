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
import { createLogger } from '../src/logger';
import type { DashboardResult } from '../src/services/dashboard';
import { DASHBOARD_PLAN_METRICS } from '../src/services/dashboard';
import { generateSiteKey } from '../src/security/siteKey';

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

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function at(date: string, hour: number): string {
  return `${date} ${String(hour).padStart(2, '0')}:00:00`;
}

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafKeys(child, prefix === '' ? key : `${prefix}.${key}`),
    );
  }
  return [prefix];
}

describe.skipIf(testHost === undefined || testHost === '')('M14 owner dashboard metrics API', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let adminCookie: string;
  let orgId: number;
  let orgBId: number;

  const ownerEmail = 'owner.m14@apextest.local';
  const ownerPassword = 'OwnerM14Passw0rd!26x';
  const recEmail = 'rec.m14@apextest.local';
  const recPassword = 'RecM14Passw0rd!26x';
  const ownerBEmail = 'owner.m14b@apextest.local';
  const ownerBPassword = 'OwnerM14BPassw0rd!26x';
  const adminEmail = 'admin.m14@apextest.local';
  const adminPassword = 'AdminM14Passw0rd!26x';

  const today = dateDaysAgo(0);
  const windowFrom = dateDaysAgo(10);
  const windowTo = today;

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
      [name, generateSiteKey()],
    );
    return row.insertId;
  }

  async function insertUser(
    organizationId: number | null,
    email: string,
    password: string,
    role: string,
  ): Promise<void> {
    const hash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [organizationId, email, hash, role],
    );
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookie(res);
  }

  function dashboard(cookieValue: string, query = ''): request.Test {
    return request(app)
      .get(`/api/organizations/${orgId}/dashboard${query}`)
      .set('Cookie', cookieValue);
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
    await pool.query('DELETE FROM call_events');
    await pool.query('DELETE FROM review_requests');
    await pool.query('DELETE FROM recall_messages');
    await pool.query('DELETE FROM recalls');
    await pool.query('DELETE FROM no_show_messages');
    await pool.query('DELETE FROM no_show_cases');
    await pool.query('DELETE FROM appointment_reminders');
    await pool.query('DELETE FROM appointments');
    await pool.query('DELETE FROM communication_messages');
    await pool.query('DELETE FROM lead_activities');
    await pool.query('DELETE FROM leads');
    await pool.query('DELETE FROM patients');
    await pool.query('DELETE FROM users');
    await pool.query('DELETE FROM organizations');

    orgId = await insertOrg('M14 Clinic');
    orgBId = await insertOrg('M14 Clinic B');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
    await insertUser(null, adminEmail, adminPassword, 'admin');

    const [patientA] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgId, 'Pat', 'IENTA', '+15550000014'],
    );
    const patientAId = patientA.insertId;
    const [patientB] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgId, 'Pat', 'IENTB', '+15550000015'],
    );
    const patientBId = patientB.insertId;

    async function insertLead(status: string, createdAt: string, phone: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO leads (organization_id, first_name, last_name, phone, source, status, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orgId, 'Lead', 'Fixture', phone, 'MANUAL', status, createdAt],
      );
      return row.insertId;
    }

    await insertLead('NEW', at(dateDaysAgo(3), 9), '+15550000001');
    const lead2 = await insertLead('CONTACTED', at(dateDaysAgo(2), 9), '+15550000002');
    const lead3 = await insertLead('CONTACTED', at(dateDaysAgo(400), 9), '+15550000003');
    const lead4 = await insertLead('APPOINTMENT_BOOKED', at(dateDaysAgo(1), 9), '+15550000004');
    await insertLead('CONTACTED', at(dateDaysAgo(400), 10), '+15550000005');

    await pool.query(
      "INSERT INTO lead_activities (lead_id, action, detail, created_at) VALUES (?, 'status_changed', ?, ?)",
      [lead2, 'status: NEW -> CONTACTED', at(dateDaysAgo(1), 10)],
    );
    await pool.query(
      "INSERT INTO lead_activities (lead_id, action, detail, created_at) VALUES (?, 'status_changed', ?, ?)",
      [lead3, 'status: NEW -> CONTACTED', at(dateDaysAgo(2), 10)],
    );

    async function insertAppointment(
      date: string,
      status: string,
      createdAt: string,
      extra: { leadId?: number; previousId?: number } = {},
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO appointments (organization_id, patient_id, lead_id, appointment_date,' +
          ' appointment_time, status, previous_appointment_id, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orgId,
          patientAId,
          extra.leadId ?? null,
          date,
          '09:00:00',
          status,
          extra.previousId ?? null,
          createdAt,
        ],
      );
      return row.insertId;
    }

    const appt1 = await insertAppointment(dateDaysAgo(3), 'SCHEDULED', at(dateDaysAgo(4), 9));
    await insertAppointment(dateDaysAgo(2), 'CONFIRMED', at(dateDaysAgo(3), 9));
    await insertAppointment(dateDaysAgo(1), 'COMPLETED', at(dateDaysAgo(2), 9));
    await insertAppointment(today, 'NO_SHOW', at(dateDaysAgo(1), 8), { leadId: lead4 });
    await insertAppointment(dateDaysAgo(3), 'CANCELLED', at(dateDaysAgo(1), 7), {
      previousId: appt1,
    });
    await insertAppointment(dateDaysAgo(400), 'SCHEDULED', at(dateDaysAgo(400), 9));
    await insertAppointment(dateDaysAgo(-30), 'SCHEDULED', at(dateDaysAgo(500), 9));

    await pool.query(
      'INSERT INTO recalls (organization_id, patient_id, due_date, status, opened_at) VALUES (?, ?, ?, ?, ?)',
      [orgId, patientAId, dateDaysAgo(2), 'DUE', at(dateDaysAgo(10), 9)],
    );
    await pool.query(
      'INSERT INTO recalls (organization_id, patient_id, due_date, status, last_contacted_at, opened_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?)',
      [
        orgId,
        patientAId,
        dateDaysAgo(400),
        'CONTACTED',
        at(dateDaysAgo(1), 9),
        at(dateDaysAgo(400), 9),
      ],
    );
    await pool.query(
      'INSERT INTO recalls (organization_id, patient_id, due_date, status, closed_at, opened_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?)',
      [
        orgId,
        patientBId,
        dateDaysAgo(15),
        'BOOKED',
        at(dateDaysAgo(2), 9),
        at(dateDaysAgo(20), 9),
      ],
    );
    await pool.query(
      'INSERT INTO recalls (organization_id, patient_id, due_date, status, opened_at) VALUES (?, ?, ?, ?, ?)',
      [orgId, patientAId, today, 'DUE', at(dateDaysAgo(10), 10)],
    );
    await pool.query(
      'INSERT INTO recalls (organization_id, patient_id, due_date, status, opened_at) VALUES (?, ?, ?, ?, ?)',
      [orgId, patientAId, dateDaysAgo(-30), 'DUE', at(today, 11)],
    );

    async function insertMessage(row: {
      direction: string;
      status: string;
      body: string;
      key: string;
      createdAt: string;
      leadId?: number | null;
      sentAt?: string | null;
      deliveredAt?: string | null;
      updatedAt?: string;
    }): Promise<void> {
      await pool.query(
        'INSERT INTO communication_messages (organization_id, channel, direction, recipient, body,' +
          ' status, idempotency_key, lead_id, sent_at, delivered_at, created_at, updated_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orgId,
          'SMS',
          row.direction,
          '+15550000009',
          row.body,
          row.status,
          row.key,
          row.leadId ?? null,
          row.sentAt ?? null,
          row.deliveredAt ?? null,
          row.createdAt,
          row.updatedAt ?? row.createdAt,
        ],
      );
    }

    await insertMessage({
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      body: 'm14 out delivered',
      key: 'm14-msg-1',
      createdAt: at(dateDaysAgo(4), 9),
      sentAt: at(dateDaysAgo(3), 9),
      deliveredAt: at(dateDaysAgo(2), 9),
    });
    await insertMessage({
      direction: 'OUTBOUND',
      status: 'SENT',
      body: 'm14 out sent',
      key: 'm14-msg-2',
      createdAt: at(dateDaysAgo(3), 9),
      sentAt: at(dateDaysAgo(2), 9),
    });
    await insertMessage({
      direction: 'OUTBOUND',
      status: 'FAILED',
      body: 'm14 out failed',
      key: 'm14-msg-3',
      createdAt: at(dateDaysAgo(2), 9),
      updatedAt: at(dateDaysAgo(2), 10),
    });
    await insertMessage({
      direction: 'INBOUND',
      status: 'SENT',
      body: 'm14 reply with lead',
      key: 'm14-msg-4',
      createdAt: at(dateDaysAgo(1), 9),
      leadId: lead2,
    });
    await insertMessage({
      direction: 'INBOUND',
      status: 'SENT',
      body: 'm14 reply no lead',
      key: 'm14-msg-5',
      createdAt: at(today, 9),
    });
    await insertMessage({
      direction: 'OUTBOUND',
      status: 'DELIVERED',
      body: 'm14 out old',
      key: 'm14-msg-6',
      createdAt: at(dateDaysAgo(400), 9),
      sentAt: at(dateDaysAgo(400), 9),
      deliveredAt: at(dateDaysAgo(400), 9),
    });
    await insertMessage({
      direction: 'OUTBOUND',
      status: 'PENDING',
      body: 'm14 out pending',
      key: 'm14-msg-7',
      createdAt: at(today, 10),
    });

    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger });

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
    adminCookie = await login(adminEmail, adminPassword);
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  it('returns every fixture-verified metric for the requested window (owner)', async () => {
    const res = await dashboard(ownerCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    expect(body.window.from).toBe(windowFrom);
    expect(body.window.to).toBe(windowTo);
    expect(body.window.basis).toContain('UTC');
    expect(body.metrics).toEqual({
      leads: { new: 3, contacted: 2, converted: 1, responseRate: 0.3333 },
      leadResponses: 1,
      appointments: {
        booked: 5,
        scheduled: 1,
        confirmed: 1,
        completed: 1,
        noShows: 1,
        rebooked: 1,
      },
      recall: { due: 2, contacted: 1, booked: 1 },
      messages: { sent: 2, patientReplies: 2 },
      delivery: { delivered: 1, deliveredRate: 0.5 },
      failures: { failed: 1, failedRate: 0.3333 },
    });
  });

  it('excludes rows anchored outside the requested window (past period)', async () => {
    const pastFrom = dateDaysAgo(450);
    const pastTo = dateDaysAgo(350);
    const res = await dashboard(ownerCookie, `?from=${pastFrom}&to=${pastTo}`);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    expect(body.metrics.leads).toEqual({ new: 2, contacted: 0, converted: 0, responseRate: 0 });
    expect(body.metrics.appointments).toEqual({
      booked: 1,
      scheduled: 1,
      confirmed: 0,
      completed: 0,
      noShows: 0,
      rebooked: 0,
    });
    expect(body.metrics.recall).toEqual({ due: 1, contacted: 0, booked: 0 });
    expect(body.metrics.messages).toEqual({ sent: 1, patientReplies: 0 });
    expect(body.metrics.delivery).toEqual({ delivered: 1, deliveredRate: 1 });
    expect(body.metrics.failures).toEqual({ failed: 0, failedRate: 0 });
    expect(body.metrics.leadResponses).toBe(0);
  });

  it('returns a zero-filled future window with null rates', async () => {
    const from = dateDaysAgo(-10);
    const to = dateDaysAgo(-11);
    const res = await dashboard(ownerCookie, `?from=${from}&to=${to}`);
    expect(res.status, JSON.stringify({ from, to, body: res.body })).toBe(200);
    const body = res.body as DashboardResult;
    expect(body.metrics.leads).toEqual({ new: 0, contacted: 0, converted: 0, responseRate: null });
    expect(body.metrics.appointments).toEqual({
      booked: 0,
      scheduled: 0,
      confirmed: 0,
      completed: 0,
      noShows: 0,
      rebooked: 0,
    });
    expect(body.metrics.delivery).toEqual({ delivered: 0, deliveredRate: null });
    expect(body.metrics.failures).toEqual({ failed: 0, failedRate: null });
    expect(body.trends.daily).toHaveLength(2);
    expect(body.trends.daily[0]).toEqual({
      date: from,
      newLeads: 0,
      messagesSent: 0,
      patientReplies: 0,
    });
  });

  it('serves zero-filled trends whose daily sums match the window totals', async () => {
    const res = await dashboard(ownerCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    const daily = body.trends.daily;
    expect(daily).toHaveLength(11);
    expect(daily[0]?.date).toBe(windowFrom);
    expect(daily[daily.length - 1]?.date).toBe(windowTo);
    const sum = (key: 'newLeads' | 'messagesSent' | 'patientReplies'): number =>
      daily.reduce((total, point) => total + point[key], 0);
    expect(sum('newLeads')).toBe(body.metrics.leads.new);
    expect(sum('messagesSent')).toBe(body.metrics.messages.sent);
    expect(sum('patientReplies')).toBe(body.metrics.messages.patientReplies);
    const byDate = new Map(daily.map((point) => [point.date, point]));
    expect(byDate.get(dateDaysAgo(3))?.newLeads).toBe(1);
    expect(byDate.get(dateDaysAgo(2))?.newLeads).toBe(1);
    expect(byDate.get(dateDaysAgo(1))?.newLeads).toBe(1);
    expect(byDate.get(dateDaysAgo(3))?.messagesSent).toBe(1);
    expect(byDate.get(dateDaysAgo(2))?.messagesSent).toBe(1);
    expect(byDate.get(dateDaysAgo(1))?.patientReplies).toBe(1);
    expect(byDate.get(today)?.patientReplies).toBe(1);
  });

  it('documents every metric and maps all ten plan metrics', async () => {
    const res = await dashboard(ownerCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    const leaves = leafKeys(body.metrics);
    expect(leaves.length).toBeGreaterThan(15);
    for (const key of leaves) {
      expect(body.definitions.metrics[key], `missing definition for ${key}`).toBeTruthy();
    }
    expect(Object.keys(body.definitions.planMetrics).sort()).toEqual([
      'Appointments',
      'Confirmations',
      'Delivery',
      'Failures',
      'Lead responses',
      'Leads',
      'Messages',
      'No-shows',
      'Rebookings',
      'Recall',
    ]);
    expect(body.definitions.planMetrics).toEqual(DASHBOARD_PLAN_METRICS);
    for (const keys of Object.values(body.definitions.planMetrics)) {
      for (const key of keys) {
        expect(
          body.definitions.metrics[key],
          `plan metric references undefined key ${key}`,
        ).toBeTruthy();
      }
    }
  });

  it('defaults to a 30-day window ending today when no range is supplied', async () => {
    const res = await dashboard(ownerCookie);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    expect(body.window.to).toBe(today);
    expect(body.window.from).toBe(dateDaysAgo(29));
    expect(body.trends.daily).toHaveLength(30);
  });

  it('allows the platform administrator to read the dashboard', async () => {
    const res = await dashboard(adminCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(200);
  });

  it('rejects the receptionist with 403 per the MVP owner-only dashboard', async () => {
    const res = await dashboard(recCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a member of another organization', async () => {
    const res = await dashboard(ownerBCookie, `?from=${windowFrom}&to=${windowTo}`);
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).get(`/api/organizations/${orgId}/dashboard`);
    expect(res.status).toBe(401);
  });

  it('rejects malformed or inverted ranges with 400', async () => {
    const bad = await dashboard(ownerCookie, '?from=10-10-2026');
    expect(bad.status).toBe(400);
    const impossible = await dashboard(ownerCookie, '?to=2026-02-30');
    expect(impossible.status).toBe(400);
    const inverted = await dashboard(ownerCookie, `?from=${windowTo}&to=${windowFrom}`);
    expect(inverted.status).toBe(400);
    const tooWide = await dashboard(ownerCookie, '?from=2020-01-01&to=2026-12-01');
    expect(tooWide.status).toBe(400);
  });

  it('scopes metrics to the requested organization only', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgBId}/dashboard?from=${windowFrom}&to=${windowTo}`)
      .set('Cookie', ownerBCookie);
    expect(res.status).toBe(200);
    const body = res.body as DashboardResult;
    expect(body.metrics.leads).toEqual({ new: 0, contacted: 0, converted: 0, responseRate: null });
    expect(body.metrics.messages).toEqual({ sent: 0, patientReplies: 0 });
    expect(body.trends.daily).toHaveLength(11);
  });
});
