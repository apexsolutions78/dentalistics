import 'dotenv/config';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { registerProvider } from '../src/communications/registry';
import { MockProvider } from '../src/communications/mockProvider';
import { TELEPHONY_CONFIG_META_KEY, loadTelephonyConfig } from '../src/telephony/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';
import { runReminderTick } from '../src/automation/reminders';

const testHost = process.env.TEST_DB_HOST;
const SIGNING_SECRET = 'm19-test-secret-value';

const LEAD_COUNT = 5000;
const PATIENT_COUNT = 1000;
const MIXED_APPT_COUNT = 2000;
const TICK_APPT_BASE = 930000;
const TICK_APPT_COUNT = 900;
const TICK_PENDING = 700;
const TICK_FAILED_RETRY = 100;
const MESSAGE_COUNT = 2000;
const FAILED_MESSAGE_COUNT = 400;
const WEBHOOK_EVENT_COUNT = 500;
const ERROR_EVENT_COUNT = 200;
const AUDIT_COUNT = 500;

const BUDGET = {
  list: 3000,
  dashboard: 5000,
  observability: 3000,
  tickInitial: 120000,
  tickConcurrent: 150000,
  burst: 15000,
};

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

interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  fields?: Record<string, unknown>;
}

function captureLogger(): Logger & { entries: CapturedLog[] } {
  const entries: CapturedLog[] = [];
  const make = (): Logger & { entries: CapturedLog[] } => ({
    entries,
    debug: (message, fields) => {
      entries.push({ level: 'debug', message, fields });
    },
    info: (message, fields) => {
      entries.push({ level: 'info', message, fields });
    },
    warn: (message, fields) => {
      entries.push({ level: 'warn', message, fields });
    },
    error: (message, fields) => {
      entries.push({ level: 'error', message, fields });
    },
    child: () => make(),
  });
  return make();
}

function flatten(body: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') {
      params[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      params[key] = String(value);
    }
  }
  return params;
}

function signParams(fullUrl: string, params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params).sort();
  let payload = fullUrl;
  for (const key of keys) {
    payload += key + params[key];
  }
  return createHmac('sha1', secret).update(payload, 'utf8').digest('base64');
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  const ms = Date.now() - start;
  console.log(`[M19] ${label}: ${ms}ms`);
  return { value, ms };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000);
}

function dateOnly(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

describe.skipIf(testHost === undefined || testHost === '')('M19 performance and reliability', () => {
  let pool: mysql.Pool;
  let app: Express;
  let server: Server;
  let serverPort: number;
  let logger: Logger & { entries: CapturedLog[] };
  let ownerCookie: string;
  let orgId: number;
  let mockProvider: MockProvider;

  const ownerEmail = 'owner.m19@apextest.local';
  const ownerPassword = 'OwnerM19Passw0rd!26x';

  function obsPath(suffix: string): string {
    return `/api/organizations/${orgId}/observability${suffix}`;
  }

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key, timezone) VALUES (?, ?, ?)',
      [name, generateSiteKey(), 'UTC'],
    );
    return row.insertId;
  }

  async function insertUser(
    organizationId: number,
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

  async function setTelephonyConfig(patch: Record<string, unknown>): Promise<void> {
    const current = await loadTelephonyConfig(pool);
    const merged: Record<string, unknown> = { ...current, ...patch };
    await pool.query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [TELEPHONY_CONFIG_META_KEY, JSON.stringify(merged)],
    );
  }

  async function bulkInsert(table: string, columns: string, rows: unknown[][]): Promise<void> {
    const names = columns.split(',').map((part) => part.trim());
    const tuple = `(${names.map(() => '?').join(', ')})`;
    const CHUNK = 400;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK);
      const values = chunk.map(() => tuple).join(', ');
      await pool.query(`INSERT INTO ${table} (${columns}) VALUES ${values}`, chunk.flat());
    }
  }

  async function countMessages(): Promise<number> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM communication_messages',
    );
    return Number(rows[0]?.n ?? 0);
  }

  function webhookReq(eventId: string): request.Test {
    const pathName = `/api/webhooks/telephony/mock/${orgId}`;
    const fullUrl = `http://127.0.0.1:${serverPort}${pathName}`;
    const body: Record<string, unknown> = {
      eventId,
      status: 'answered',
      from: '+15551230900',
      to: '+15550000009',
    };
    const signature = signParams(fullUrl, flatten(body), SIGNING_SECRET);
    return request(server).post(pathName).set('x-mock-signature', signature).send(body);
  }

  beforeAll(async () => {
    const cfg = testDbConfig();
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
    await pool.query('DELETE FROM webhook_events');
    await pool.query('DELETE FROM error_events');
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
    await pool.query('DELETE FROM organization_settings');
    await pool.query('DELETE FROM app_meta');
    await pool.query('DELETE FROM audit_logs');

    orgId = await insertOrg('M19 Clinic');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');

    mockProvider = new MockProvider();
    registerProvider(mockProvider);
    logger = captureLogger();
    app = createApp({ db: pool, logger });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    serverPort = (server.address() as AddressInfo).port;

    ownerCookie = await login(ownerEmail, ownerPassword);
    await setTelephonyConfig({ enabled: true, signingSecret: SIGNING_SECRET });

    const leadRows: unknown[][] = [];
    const leadSources = ['WEBSITE', 'MISSED_CALL', 'MANUAL', 'OTHER'];
    const leadStatuses = ['NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED', 'LOST', 'CLOSED'];
    for (let i = 0; i < LEAD_COUNT; i += 1) {
      leadRows.push([
        orgId,
        `Perf${i}`,
        'Lead',
        `15559${String(i).padStart(6, '0')}`,
        leadSources[i % 4],
        leadStatuses[i % 6],
        'm19 seed',
        daysAgo(i % 30),
      ]);
    }
    await bulkInsert(
      'leads',
      'organization_id, first_name, last_name, phone, source, status, notes, created_at',
      leadRows,
    );

    const patientRows: unknown[][] = [];
    for (let i = 0; i < PATIENT_COUNT; i += 1) {
      patientRows.push([
        910000 + i,
        orgId,
        `Perf${i}`,
        'Patient',
        `15560${String(i).padStart(6, '0')}`,
        null,
        null,
        daysAgo(60),
      ]);
    }
    await bulkInsert(
      'patients',
      'id, organization_id, first_name, last_name, phone, email, notes, created_at',
      patientRows,
    );

    const mixedStatuses = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
    const mixedApptRows: unknown[][] = [];
    for (let i = 0; i < MIXED_APPT_COUNT; i += 1) {
      mixedApptRows.push([
        920000 + i,
        orgId,
        910000 + (i % PATIENT_COUNT),
        null,
        dateOnly((i % 14) - 3),
        `${String(8 + (i % 10)).padStart(2, '0')}:00:00`,
        mixedStatuses[i % 5],
        'Cleaning',
        'Dr. Perf',
        null,
        daysAgo(i % 89),
      ]);
    }
    await bulkInsert(
      'appointments',
      `id, organization_id, patient_id, lead_id, appointment_date, appointment_time,
       status, service, provider, created_by, created_at`,
      mixedApptRows,
    );

    const tickApptRows: unknown[][] = [];
    for (let i = 0; i < TICK_APPT_COUNT; i += 1) {
      tickApptRows.push([
        TICK_APPT_BASE + i,
        orgId,
        910000 + ((i + 500) % PATIENT_COUNT),
        null,
        dateOnly(1 + (i % 7)),
        '10:00:00',
        'SCHEDULED',
        'Cleaning',
        'Dr. Perf',
        null,
        daysAgo(1),
      ]);
    }
    await bulkInsert(
      'appointments',
      `id, organization_id, patient_id, lead_id, appointment_date, appointment_time,
       status, service, provider, created_by, created_at`,
      tickApptRows,
    );

    const reminderRows: unknown[][] = [];
    for (let i = 0; i < TICK_APPT_COUNT; i += 1) {
      let status: string;
      let attempts: number;
      let lastError: string | null;
      let sentAt: Date | null;
      if (i < TICK_PENDING) {
        status = 'PENDING';
        attempts = 0;
        lastError = null;
        sentAt = null;
      } else if (i < TICK_PENDING + TICK_FAILED_RETRY) {
        status = 'FAILED';
        attempts = 1;
        lastError = 'seed failure';
        sentAt = null;
      } else {
        status = 'SENT';
        attempts = 1;
        lastError = null;
        sentAt = daysAgo(1);
      }
      reminderRows.push([
        orgId,
        TICK_APPT_BASE + i,
        i,
        new Date(Date.now() - 60000),
        status,
        null,
        attempts,
        lastError,
        sentAt,
      ]);
    }
    await bulkInsert(
      'appointment_reminders',
      `organization_id, appointment_id, offset_hours, scheduled_at, status,
       message_id, attempts, last_error, sent_at`,
      reminderRows,
    );

    const messageRows: unknown[][] = [];
    for (let i = 0; i < MESSAGE_COUNT; i += 1) {
      const statusIdx = i % 5;
      let status: string;
      let providerKey: string | null;
      let providerMessageId: string | null;
      let providerError: string | null;
      let attempts: number;
      let sentAt: Date | null;
      let deliveredAt: Date | null;
      if (statusIdx <= 2) {
        status = 'SENT';
        providerKey = 'mock';
        providerMessageId = `seed-msg-${i}`;
        providerError = null;
        attempts = 1;
        sentAt = daysAgo(i % 30);
        deliveredAt = i % 2 === 0 ? new Date((sentAt as Date).getTime() + 60000) : null;
      } else if (statusIdx === 3) {
        status = 'PENDING';
        providerKey = null;
        providerMessageId = null;
        providerError = null;
        attempts = 0;
        sentAt = null;
        deliveredAt = null;
      } else {
        status = 'FAILED';
        providerKey = 'mock';
        providerMessageId = null;
        providerError = 'seed failure';
        attempts = 1;
        sentAt = null;
        deliveredAt = null;
      }
      messageRows.push([
        orgId,
        'SMS',
        `15561${String(i).padStart(6, '0')}`,
        'M19 seed message',
        status,
        providerKey,
        providerMessageId,
        providerError,
        `m19-seed-${i}`,
        attempts,
        'OUTBOUND',
        daysAgo(i % 30),
        sentAt,
        deliveredAt,
      ]);
    }
    await bulkInsert(
      'communication_messages',
      `organization_id, channel, recipient, body, status, provider_key, provider_message_id,
       provider_error, idempotency_key, attempts, direction, created_at, sent_at, delivered_at`,
      messageRows,
    );

    const webhookRows: unknown[][] = [];
    for (let i = 0; i < WEBHOOK_EVENT_COUNT; i += 1) {
      webhookRows.push([
        orgId,
        i % 2 === 0 ? 'telephony' : 'whatsapp',
        'POST',
        200,
        'processed',
        'mock',
        '203.0.113.9',
        'm19 seed',
        daysAgo(i % 30),
      ]);
    }
    await bulkInsert(
      'webhook_events',
      'organization_id, source, request_method, http_status, outcome, provider_key, remote_ip, detail, created_at',
      webhookRows,
    );

    const errorRows: unknown[][] = [];
    for (let i = 0; i < ERROR_EVENT_COUNT; i += 1) {
      errorRows.push([
        orgId,
        'request',
        'GET',
        '/api/seed',
        500,
        'internal_error',
        'Error',
        'm19 seed error',
        daysAgo(i % 30),
      ]);
    }
    await bulkInsert(
      'error_events',
      `organization_id, scope, request_method, request_path, http_status, error_code,
       error_name, error_message, created_at`,
      errorRows,
    );

    const auditRows: unknown[][] = [];
    for (let i = 0; i < AUDIT_COUNT; i += 1) {
      auditRows.push([orgId, null, 'seed.action', 'm19 seed audit', daysAgo(i % 30)]);
    }
    await bulkInsert('audit_logs', 'organization_id, user_id, action, detail, created_at', auditRows);
  }, 120_000);

  afterAll(async () => {
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('serves large lead lists within budget', async () => {
    const first = await timed('leads list limit=50', () =>
      request(app).get(`/api/organizations/${orgId}/leads?limit=50`).set('Cookie', ownerCookie),
    );
    expect(first.value.status).toBe(200);
    expect(first.value.body.total).toBe(LEAD_COUNT);
    expect(first.value.body.leads).toHaveLength(50);
    expect(first.ms).toBeLessThan(BUDGET.list);

    const deep = await timed('leads deep offset', () =>
      request(app)
        .get(`/api/organizations/${orgId}/leads?limit=50&offset=${LEAD_COUNT - 50}`)
        .set('Cookie', ownerCookie),
    );
    expect(deep.value.status).toBe(200);
    expect(deep.value.body.leads).toHaveLength(50);
    expect(deep.ms).toBeLessThan(BUDGET.list);

    const search = await timed('leads search', () =>
      request(app).get(`/api/organizations/${orgId}/leads?q=Perf42`).set('Cookie', ownerCookie),
    );
    expect(search.value.status).toBe(200);
    expect(search.value.body.total).toBeGreaterThanOrEqual(1);
    expect(search.ms).toBeLessThan(BUDGET.list);

    const filtered = await timed('leads status filter', () =>
      request(app)
        .get(`/api/organizations/${orgId}/leads?status=NEW`)
        .set('Cookie', ownerCookie),
    );
    expect(filtered.value.status).toBe(200);
    expect(filtered.ms).toBeLessThan(BUDGET.list);
  });

  it('serves large appointment lists within budget', async () => {
    const first = await timed('appointments list limit=50', () =>
      request(app)
        .get(`/api/organizations/${orgId}/appointments?limit=50`)
        .set('Cookie', ownerCookie),
    );
    expect(first.value.status).toBe(200);
    expect(first.value.body.total).toBe(MIXED_APPT_COUNT + TICK_APPT_COUNT);
    expect(first.value.body.appointments).toHaveLength(50);
    expect(first.ms).toBeLessThan(BUDGET.list);

    const deep = await timed('appointments deep offset', () =>
      request(app)
        .get(`/api/organizations/${orgId}/appointments?limit=50&offset=${MIXED_APPT_COUNT + TICK_APPT_COUNT - 50}`)
        .set('Cookie', ownerCookie),
    );
    expect(deep.value.status).toBe(200);
    expect(deep.value.body.appointments).toHaveLength(50);
    expect(deep.ms).toBeLessThan(BUDGET.list);

    const filtered = await timed('appointments status filter', () =>
      request(app)
        .get(`/api/organizations/${orgId}/appointments?status=SCHEDULED&limit=50`)
        .set('Cookie', ownerCookie),
    );
    expect(filtered.value.status).toBe(200);
    expect(filtered.ms).toBeLessThan(BUDGET.list);

    const ranged = await timed('appointments date range filter', () =>
      request(app)
        .get(
          `/api/organizations/${orgId}/appointments?from=${dateOnly(-7)}&to=${dateOnly(7)}&limit=50`,
        )
        .set('Cookie', ownerCookie),
    );
    expect(ranged.value.status).toBe(200);
    expect(ranged.ms).toBeLessThan(BUDGET.list);
  });

  it('computes dashboard metrics at scale matching independent SQL', async () => {
    const from = dateOnly(-40);
    const to = dateOnly(40);
    const dash = await timed('dashboard range', () =>
      request(app)
        .get(`/api/organizations/${orgId}/dashboard?from=${from}&to=${to}`)
        .set('Cookie', ownerCookie),
    );
    expect(dash.value.status).toBe(200);
    expect(dash.ms).toBeLessThan(BUDGET.dashboard);
    const metrics = dash.value.body.metrics as Record<string, any>;
    expect(dash.value.body.definitions.planMetrics).toBeDefined();

    const [leadRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM leads
       WHERE organization_id = ? AND created_at >= ? AND created_at <= ?`,
      [orgId, `${from} 00:00:00`, `${to} 23:59:59`],
    );
    expect(Number(metrics.leads.new)).toBe(Number(leadRows[0]?.n ?? 0));

    const [scheduledRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE organization_id = ? AND status = 'SCHEDULED'
         AND appointment_date >= ? AND appointment_date <= ?`,
      [orgId, from, to],
    );
    expect(Number(metrics.appointments.scheduled)).toBe(Number(scheduledRows[0]?.n ?? 0));

    const [completedRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE organization_id = ? AND status = 'COMPLETED'
         AND appointment_date >= ? AND appointment_date <= ?`,
      [orgId, from, to],
    );
    expect(Number(metrics.appointments.completed)).toBe(Number(completedRows[0]?.n ?? 0));

    const [sentRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM communication_messages
       WHERE organization_id = ? AND direction = 'OUTBOUND'
         AND sent_at >= ? AND sent_at <= ?`,
      [orgId, `${from} 00:00:00`, `${to} 23:59:59`],
    );
    expect(Number(metrics.messages.sent)).toBe(Number(sentRows[0]?.n ?? 0));
  });

  it('serves observability lists over large datasets within budget', async () => {
    const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ?',
      [orgId],
    );
    const auditCount = Number(auditRows[0]?.n ?? 0);
    expect(auditCount).toBeGreaterThanOrEqual(AUDIT_COUNT);
    const endpoints: Array<{ suffix: string; expected: number; label: string }> = [
      { suffix: '/automation-logs', expected: TICK_APPT_COUNT, label: 'automation-logs' },
      { suffix: '/communication-logs', expected: MESSAGE_COUNT, label: 'communication-logs' },
      { suffix: '/webhook-logs', expected: WEBHOOK_EVENT_COUNT, label: 'webhook-logs' },
      { suffix: '/error-logs', expected: ERROR_EVENT_COUNT, label: 'error-logs' },
      { suffix: '/audit-logs', expected: auditCount, label: 'audit-logs' },
      {
        suffix: '/failed-jobs',
        expected: TICK_FAILED_RETRY + FAILED_MESSAGE_COUNT,
        label: 'failed-jobs',
      },
    ];
    for (const endpoint of endpoints) {
      const result = await timed(`obs ${endpoint.label}`, () =>
        request(app).get(obsPath(endpoint.suffix)).set('Cookie', ownerCookie),
      );
      expect(result.value.status, endpoint.label).toBe(200);
      expect(result.value.body.total, endpoint.label).toBe(endpoint.expected);
      expect(result.ms, endpoint.label).toBeLessThan(BUDGET.observability);
    }

    const deep = await timed('obs automation-logs deep offset', () =>
      request(app)
        .get(obsPath(`/automation-logs?limit=50&offset=${TICK_APPT_COUNT - 50}`))
        .set('Cookie', ownerCookie),
    );
    expect(deep.value.status).toBe(200);
    expect(deep.value.body.logs).toHaveLength(50);
    expect(deep.ms).toBeLessThan(BUDGET.observability);
  });

  it('runs the reminder tick over a 900-row backlog', async () => {
    const beforeCount = await countMessages();
    const run = await timed('reminder tick initial', () =>
      runReminderTick(pool, logger, { batchSize: 1000 }),
    );
    expect(run.value.processed).toBe(TICK_PENDING + TICK_FAILED_RETRY);
    expect(run.value.sent).toBe(TICK_PENDING + TICK_FAILED_RETRY);
    expect(run.value.failed).toBe(0);
    expect(run.ms).toBeLessThan(BUDGET.tickInitial);
    const afterCount = await countMessages();
    expect(afterCount - beforeCount).toBe(TICK_PENDING + TICK_FAILED_RETRY);

    const rerun = await timed('reminder tick second pass', () =>
      runReminderTick(pool, logger, { batchSize: 1000 }),
    );
    expect(rerun.value.processed).toBe(0);

    const [sentRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM appointment_reminders
       WHERE appointment_id >= ? AND appointment_id < ? AND status = 'SENT'`,
      [TICK_APPT_BASE, TICK_APPT_BASE + TICK_APPT_COUNT],
    );
    expect(Number(sentRows[0]?.n ?? 0)).toBe(TICK_APPT_COUNT);
  }, 300_000);

  it('never double-sends when two reminder ticks run concurrently', async () => {
    await pool.query(
      `UPDATE appointment_reminders
       SET status = 'PENDING', attempts = 0, message_id = NULL, sent_at = NULL,
           last_error = NULL, scheduled_at = UTC_TIMESTAMP()
       WHERE appointment_id >= ? AND appointment_id < ?`,
      [TICK_APPT_BASE, TICK_APPT_BASE + TICK_APPT_COUNT],
    );
    await pool.query(
      `DELETE FROM communication_messages WHERE idempotency_key LIKE 'reminder:%'`,
    );
    mockProvider = new MockProvider();
    registerProvider(mockProvider);
    const beforeMessages = await countMessages();
    const start = Date.now();
    const [a, b] = await Promise.all([
      runReminderTick(pool, logger, { batchSize: 1000 }),
      runReminderTick(pool, logger, { batchSize: 1000 }),
    ]);
    const ms = Date.now() - start;
    console.log(`[M19] concurrent ticks (2x): ${ms}ms`);
    expect(ms).toBeLessThan(BUDGET.tickConcurrent);

    expect(a.sent + b.sent).toBe(TICK_APPT_COUNT);
    expect(a.failed + b.failed).toBe(0);
    expect(mockProvider.attempts.length).toBe(TICK_APPT_COUNT);
    expect(await countMessages()).toBe(beforeMessages + TICK_APPT_COUNT);

    const [sentRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM appointment_reminders
       WHERE appointment_id >= ? AND appointment_id < ? AND status = 'SENT' AND attempts = 1`,
      [TICK_APPT_BASE, TICK_APPT_BASE + TICK_APPT_COUNT],
    );
    expect(Number(sentRows[0]?.n ?? 0)).toBe(TICK_APPT_COUNT);
  }, 300_000);

  it('sends a failed message exactly once under concurrent retries', async () => {
    const [failRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id, attempts FROM communication_messages
       WHERE organization_id = ? AND status = 'FAILED' AND provider_key = 'mock'
       ORDER BY id ASC LIMIT 1`,
      [orgId],
    );
    expect(failRows).toHaveLength(1);
    const messageId = Number((failRows[0] as mysql.RowDataPacket).id);
    const attemptsBefore = Number((failRows[0] as mysql.RowDataPacket).attempts);

    const logStart = logger.entries.length;
    const start = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post(obsPath(`/failed-jobs/message/${messageId}/retry`))
          .set('Cookie', ownerCookie),
      ),
    );
    const ms = Date.now() - start;
    console.log(`[M19] concurrent message retries x8: ${ms}ms`);

    const codes = responses.map((res) => res.status);
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(7);

    const sentLogs = logger.entries
      .slice(logStart)
      .filter(
        (entry) =>
          entry.message === 'message sent' && entry.fields?.messageId === messageId,
      );
    expect(sentLogs).toHaveLength(1);

    const [afterRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status, attempts FROM communication_messages WHERE id = ?',
      [messageId],
    );
    expect((afterRows[0] as mysql.RowDataPacket).status).toBe('SENT');
    expect(Number((afterRows[0] as mysql.RowDataPacket).attempts)).toBe(attemptsBefore + 1);
  }, 30_000);

  it('requeues a failed reminder exactly once under concurrent retries', async () => {
    const [jobRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM appointment_reminders
       WHERE organization_id = ? AND status = 'SENT' ORDER BY id ASC LIMIT 1`,
      [orgId],
    );
    expect(jobRows).toHaveLength(1);
    const jobId = Number((jobRows[0] as mysql.RowDataPacket).id);
    await pool.query(
      `UPDATE appointment_reminders
       SET status = 'FAILED', attempts = 1, last_error = 'seed', message_id = NULL,
           scheduled_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
       WHERE id = ?`,
      [jobId],
    );

    const start = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post(obsPath(`/failed-jobs/reminder/${jobId}/retry`))
          .set('Cookie', ownerCookie),
      ),
    );
    const ms = Date.now() - start;
    console.log(`[M19] concurrent job retries x8: ${ms}ms`);

    const codes = responses.map((res) => res.status);
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(7);

    const [afterRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status, attempts, last_error FROM appointment_reminders WHERE id = ?',
      [jobId],
    );
    expect((afterRows[0] as mysql.RowDataPacket).status).toBe('PENDING');
    expect((afterRows[0] as mysql.RowDataPacket).last_error).toBeNull();
    expect(Number((afterRows[0] as mysql.RowDataPacket).attempts)).toBe(1);
  }, 30_000);

  it('processes a concurrent webhook burst with idempotent dedup', async () => {
    const requests: Array<PromiseLike<request.Response>> = [];
    for (let n = 1; n <= 20; n += 1) {
      requests.push(webhookReq(`M19-EV-${n}`));
    }
    for (let d = 0; d < 10; d += 1) {
      requests.push(webhookReq('M19-EV-5'));
    }
    const start = Date.now();
    const responses = await Promise.all(requests);
    const ms = Date.now() - start;
    console.log(`[M19] webhook burst x${responses.length}: ${ms}ms (avg ${Math.round(ms / responses.length)}ms)`);

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(ms).toBeLessThan(BUDGET.burst);

    const [countRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM call_events
       WHERE provider_key = 'mock' AND provider_event_id LIKE 'M19-EV-%'`,
    );
    expect(Number(countRows[0]?.n ?? 0)).toBe(20);
  }, 30_000);
});
