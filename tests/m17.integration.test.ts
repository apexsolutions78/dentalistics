import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';

const testHost = process.env.TEST_DB_HOST;

function testDbConfig() {
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

describe.skipIf(testHost === undefined || testHost === '')('M17 observability API', () => {
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let adminCookie: string;
  let orgAId: number;
  let orgBId: number;
  let patientA: number;
  let reminderCount = 0;
  let failedReminderId = 0;
  let providerMessageId = 0;
  let providerSentMessageId = 0;
  let noProviderMessageId = 0;

  const ownerEmail = 'owner.m17@apextest.local';
  const ownerPassword = 'OwnerM17Passw0rd!26x';
  const recEmail = 'rec.m17@apextest.local';
  const recPassword = 'RecM17Passw0rd!26x';
  const ownerBEmail = 'owner.m17b@apextest.local';
  const ownerBPassword = 'OwnerM17BPassw0rd!26x';
  const adminEmail = 'admin.m17@apextest.local';
  const adminPassword = 'AdminM17Passw0rd!26x';

  function obsPath(org: number, suffix: string): string {
    return `/api/organizations/${org}/observability${suffix}`;
  }

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key, timezone) VALUES (?, ?, ?)',
      [name, generateSiteKey(), 'UTC'],
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

  async function insertPatient(orgId: number, ck: string, phone: string): Promise<number> {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/patients`)
      .set('Cookie', ck)
      .send({ firstName: 'M17', lastName: 'Patient', phone });
    expect(res.status).toBe(201);
    return res.body.patient.id as number;
  }

  async function createAppt(
    orgId: number,
    ck: string,
    pid: number,
    date: string,
    time: string,
  ): Promise<number> {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/appointments`)
      .set('Cookie', ck)
      .send({ patientId: pid, date, time });
    expect(res.status).toBe(201);
    return res.body.appointment.id as number;
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
    await pool.query('DELETE FROM webhook_events');
    await pool.query('DELETE FROM error_events');
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
    await pool.query('DELETE FROM organization_settings');
    await pool.query('DELETE FROM app_meta');
    await pool.query('DELETE FROM audit_logs');

    orgAId = await insertOrg('M17 Clinic');
    orgBId = await insertOrg('M17 Clinic B');
    await insertUser(orgAId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgAId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
    await insertUser(null, adminEmail, adminPassword, 'admin');

    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger, uiDistDir: null });

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
    adminCookie = await login(adminEmail, adminPassword);

    patientA = await insertPatient(orgAId, ownerCookie, '+15550200401');
    await createAppt(orgAId, ownerCookie, patientA, '2026-12-10', '09:00');
    const patientB = await insertPatient(orgBId, ownerBCookie, '+15550200402');
    await createAppt(orgBId, ownerBCookie, patientB, '2026-12-11', '10:00');

    const [reminderRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id FROM appointment_reminders WHERE organization_id = ? ORDER BY id LIMIT 1',
      [orgAId],
    );
    expect(reminderRows.length).toBeGreaterThan(0);
    const [countRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM appointment_reminders WHERE organization_id = ?',
      [orgAId],
    );
    reminderCount = Number((countRows[0] as mysql.RowDataPacket).total);
    failedReminderId = Number((reminderRows[0] as mysql.RowDataPacket).id);
    await pool.query(
      `UPDATE appointment_reminders
       SET status = 'FAILED', attempts = 2, last_error = 'provider_error: test boom'
       WHERE id = ?`,
      [failedReminderId],
    );

    const [recallRow] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO recalls (organization_id, patient_id, due_date, opened_at)
       VALUES (?, ?, '2026-11-01', UTC_TIMESTAMP())`,
      [orgAId, patientA],
    );
    await pool.query(
      `INSERT INTO recall_messages (recall_id, organization_id, phase, status, scheduled_at, attempts, last_error)
       VALUES (?, ?, 'INITIAL', 'FAILED', UTC_TIMESTAMP(), 3, 'provider_error: recall boom')`,
      [recallRow.insertId, orgAId],
    );

    const [msg1] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO communication_messages (organization_id, channel, recipient, body, status, idempotency_key, attempts, provider_key)
       VALUES (?, 'SMS', '+15551230001', 'm17 sent log body', 'SENT', 'm17-sent-1', 1, 'mock')`,
      [orgAId],
    );
    providerSentMessageId = msg1.insertId;
    const [msg2] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO communication_messages (organization_id, channel, recipient, body, status, idempotency_key, attempts, provider_key, provider_error)
       VALUES (?, 'SMS', '+15551230002', 'm17 retry me', 'FAILED', 'm17-fail-retry-1', 2, 'mock', 'provider_error: boom')`,
      [orgAId],
    );
    providerMessageId = msg2.insertId;
    const [msg3] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO communication_messages (organization_id, channel, recipient, body, status, idempotency_key, attempts, provider_key, provider_error)
       VALUES (?, 'WHATSAPP', '+15551230003', 'm17 no provider', 'FAILED', 'm17-fail-noprovider-1', 1, NULL, 'provider_error: gone')`,
      [orgAId],
    );
    noProviderMessageId = msg3.insertId;
    await pool.query(
      `INSERT INTO communication_messages (organization_id, channel, recipient, body, status, idempotency_key, attempts, provider_key)
       VALUES (?, 'SMS', '+15551230004', 'm17 org b failed', 'FAILED', 'm17-fail-orgb-1', 1, 'mock')`,
      [orgBId],
    );

    await pool.query(
      `INSERT INTO webhook_events (organization_id, source, request_method, http_status, outcome, provider_key, detail)
       VALUES (?, 'telephony', 'POST', 200, 'processed', 'mock', 'status=RECORDED disposition=no_action')`,
      [orgAId],
    );
    await pool.query(
      `INSERT INTO webhook_events (organization_id, source, request_method, http_status, outcome)
       VALUES (?, 'telephony', 'POST', 200, 'processed')`,
      [orgBId],
    );
    await pool.query(
      `INSERT INTO error_events (organization_id, scope, request_method, request_path, http_status, error_code, error_name, error_message)
       VALUES (?, 'request', 'POST', '/api/organizations/x/patients', 500, 'internal_error', 'Error', 'forced failure')`,
      [orgAId],
    );
    await pool.query(
      `INSERT INTO error_events (organization_id, scope, request_method, request_path, http_status, error_code, error_name, error_message)
       VALUES (?, 'request', 'GET', '/api/organizations/y/dashboard', 500, 'internal_error', 'Error', 'org b failure')`,
      [orgBId],
    );
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  it('enforces auth and roles on observability endpoints', async () => {
    const unauth = await request(app).get(obsPath(orgAId, '/automation-logs'));
    expect(unauth.status).toBe(401);

    const rec = await request(app).get(obsPath(orgAId, '/automation-logs')).set('Cookie', recCookie);
    expect(rec.status).toBe(403);

    const foreign = await request(app)
      .get(obsPath(orgAId, '/automation-logs'))
      .set('Cookie', ownerBCookie);
    expect(foreign.status).toBe(404);

    const recRetry = await request(app)
      .post(obsPath(orgAId, '/failed-jobs/reminder/1/retry'))
      .set('Cookie', recCookie);
    expect(recRetry.status).toBe(403);
  });

  it('lists automation logs across job tables with kind and status filters', async () => {
    const all = await request(app).get(obsPath(orgAId, '/automation-logs')).set('Cookie', ownerCookie);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(reminderCount + 1);
    const kinds = new Set(all.body.logs.map((row: { kind: string }) => row.kind));
    expect(kinds.has('reminder')).toBe(true);
    expect(kinds.has('recall')).toBe(true);

    const reminders = await request(app)
      .get(obsPath(orgAId, '/automation-logs?kind=reminder'))
      .set('Cookie', ownerCookie);
    expect(reminders.status).toBe(200);
    expect(reminders.body.total).toBe(reminderCount);
    expect(
      reminders.body.logs.every((row: { kind: string }) => row.kind === 'reminder'),
    ).toBe(true);

    const failed = await request(app)
      .get(obsPath(orgAId, '/automation-logs?status=FAILED'))
      .set('Cookie', ownerCookie);
    expect(failed.status).toBe(200);
    expect(failed.body.total).toBe(2);
    expect(
      failed.body.logs.every((row: { status: string }) => row.status === 'FAILED'),
    ).toBe(true);

    const badKind = await request(app)
      .get(obsPath(orgAId, '/automation-logs?kind=other'))
      .set('Cookie', ownerCookie);
    expect(badKind.status).toBe(400);
  });

  it('records telephony webhook outcomes without a payload', async () => {
    const res = await request(app).post(`/api/webhooks/telephony/nosuchprovider/${orgAId}`).send({});
    expect(res.status).toBe(404);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT organization_id, outcome, http_status FROM webhook_events
       WHERE outcome = 'unknown_provider' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    const telephonyRow = rows[0] as mysql.RowDataPacket;
    expect(telephonyRow.organization_id).toBeNull();
    expect(telephonyRow.http_status).toBe(404);
  });

  it('records whatsapp verification challenge outcomes', async () => {
    const res = await request(app).get(`/api/webhooks/whatsapp/${orgAId}`);
    expect(res.status).toBe(400);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT organization_id, outcome, http_status FROM webhook_events
       WHERE outcome = 'invalid_challenge' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length).toBe(1);
    const challengeRow = rows[0] as mysql.RowDataPacket;
    expect(challengeRow.organization_id).toBe(orgAId);
    expect(challengeRow.http_status).toBe(400);
  });

  it('lists webhook logs scoped to the organization with exact fields', async () => {
    const res = await request(app).get(obsPath(orgAId, '/webhook-logs')).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const outcomes = res.body.events.map((row: { outcome: string }) => row.outcome);
    expect(outcomes).toContain('processed');
    expect(outcomes).toContain('invalid_challenge');
    expect(outcomes).not.toContain('unknown_provider');
    const keys = Object.keys(res.body.events[0]).sort();
    expect(keys).toEqual(
      ['created_at', 'detail', 'http_status', 'id', 'outcome', 'provider_key', 'request_method', 'source'].sort(),
    );

    const wa = await request(app)
      .get(obsPath(orgAId, '/webhook-logs?source=whatsapp'))
      .set('Cookie', ownerCookie);
    expect(wa.status).toBe(200);
    expect(wa.body.total).toBe(1);
    expect(wa.body.events[0].source).toBe('whatsapp');
  });

  it('lists communication logs with status filter', async () => {
    const res = await request(app)
      .get(obsPath(orgAId, '/communication-logs'))
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.messages[0].body).toContain('m17');

    const failed = await request(app)
      .get(obsPath(orgAId, '/communication-logs?status=FAILED'))
      .set('Cookie', ownerCookie);
    expect(failed.status).toBe(200);
    expect(failed.body.total).toBe(2);

    const badStatus = await request(app)
      .get(obsPath(orgAId, '/communication-logs?status=BOGUS'))
      .set('Cookie', ownerCookie);
    expect(badStatus.status).toBe(400);
  });

  it('lists audit logs and supports action filtering', async () => {
    const res = await request(app).get(obsPath(orgAId, '/audit-logs')).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    const action = res.body.logs[0].action as string;

    const filtered = await request(app)
      .get(obsPath(orgAId, `/audit-logs?action=${encodeURIComponent(action)}`))
      .set('Cookie', ownerCookie);
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBeGreaterThanOrEqual(1);
    expect(
      filtered.body.logs.every((row: { action: string }) => row.action === action),
    ).toBe(true);
  });

  it('lists error logs scoped to the organization and ignores client errors', async () => {
    const res = await request(app).get(obsPath(orgAId, '/error-logs')).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.events[0].error_name).toBe('Error');
    expect(res.body.events[0].request_path).not.toContain('?');

    const [before] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM error_events WHERE organization_id = ?',
      [orgAId],
    );
    const clientError = await request(app)
      .get(obsPath(orgAId, '/error-logs?limit=0'))
      .set('Cookie', ownerCookie);
    expect(clientError.status).toBe(400);
    const [after] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM error_events WHERE organization_id = ?',
      [orgAId],
    );
    expect(Number((after[0] as mysql.RowDataPacket).total)).toBe(Number((before[0] as mysql.RowDataPacket).total));
  });

  it('lists failed jobs across automation tables and messages', async () => {
    const res = await request(app).get(obsPath(orgAId, '/failed-jobs')).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    const kinds = res.body.jobs.map((row: { kind: string }) => row.kind).sort();
    expect(kinds).toEqual(['message', 'message', 'recall', 'reminder']);
    expect(
      res.body.jobs.every((row: { status: string }) => row.status === 'FAILED'),
    ).toBe(true);

    const orgB = await request(app)
      .get(obsPath(orgBId, '/failed-jobs'))
      .set('Cookie', ownerBCookie);
    expect(orgB.status).toBe(200);
    expect(orgB.body.total).toBe(1);
    expect(orgB.body.jobs[0].kind).toBe('message');
  });

  it('requeues a failed automation job with attempts preserved', async () => {
    const res = await request(app)
      .post(obsPath(orgAId, `/failed-jobs/reminder/${failedReminderId}/retry`))
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.retry).toEqual({ kind: 'reminder', id: failedReminderId, action: 'requeued', status: 'PENDING' });

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status, attempts, last_error, scheduled_at FROM appointment_reminders WHERE id = ?',
      [failedReminderId],
    );
    const jobRow = rows[0] as mysql.RowDataPacket;
    expect(jobRow.status).toBe('PENDING');
    expect(jobRow.attempts).toBe(2);
    expect(jobRow.last_error).toBeNull();

    const again = await request(app)
      .post(obsPath(orgAId, `/failed-jobs/reminder/${failedReminderId}/retry`))
      .set('Cookie', ownerCookie);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('not_failed');
  });

  it('retries a failed message through the provider and sends it', async () => {
    const res = await request(app)
      .post(obsPath(orgAId, `/failed-jobs/message/${providerMessageId}/retry`))
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.retry.action).toBe('sent');
    expect(res.body.retry.status).toBe('SENT');

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status, attempts, provider_error FROM communication_messages WHERE id = ?',
      [providerMessageId],
    );
    const messageRow = rows[0] as mysql.RowDataPacket;
    expect(messageRow.status).toBe('SENT');
    expect(messageRow.attempts).toBe(3);
    expect(messageRow.provider_error).toBeNull();
  });

  it('rejects retries for missing, non-failed, unknown-kind, and providerless jobs', async () => {
    const missing = await request(app)
      .post(obsPath(orgAId, '/failed-jobs/reminder/999999/retry'))
      .set('Cookie', ownerCookie);
    expect(missing.status).toBe(404);

    const notFailed = await request(app)
      .post(obsPath(orgAId, `/failed-jobs/message/${providerSentMessageId}/retry`))
      .set('Cookie', ownerCookie);
    expect(notFailed.status).toBe(409);
    expect(notFailed.body.error.code).toBe('not_failed');

    const noProvider = await request(app)
      .post(obsPath(orgAId, `/failed-jobs/message/${noProviderMessageId}/retry`))
      .set('Cookie', ownerCookie);
    expect(noProvider.status).toBe(409);
    expect(noProvider.body.error.code).toBe('no_provider');

    const badKind = await request(app)
      .post(obsPath(orgAId, '/failed-jobs/bogus/1/retry'))
      .set('Cookie', ownerCookie);
    expect(badKind.status).toBe(400);
  });

  it('returns operational diagnostics with queue and scheduler state', async () => {
    const res = await request(app).get(obsPath(orgAId, '/diagnostics')).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    const d = res.body.diagnostics;
    expect(d.database).toBe('up');
    expect(typeof d.server.uptimeSeconds).toBe('number');
    expect(d.server.nodeVersion).toMatch(/^v/);
    expect(typeof d.queues.reminders.pending).toBe('number');
    expect(typeof d.queues.reminders.failed).toBe('number');
    expect(typeof d.queues.messages.failed).toBe('number');
    expect(d.recent.webhookEvents).toBeGreaterThanOrEqual(0);
    expect(d.recent.errorEvents).toBeGreaterThanOrEqual(1);
    expect(d.scheduler.intervalMs).toBeNull();
    expect(Object.keys(d.scheduler.ticks).sort()).toEqual(
      ['no_show', 'recall', 'reminder', 'review_request'],
    );
    expect(d.scheduler.ticks.reminder.lastSuccessAt).toBeNull();
  });

  it('serves platform-admin global error and audit logs', async () => {
    const errors = await request(app)
      .get('/api/admin/observability/error-logs')
      .set('Cookie', adminCookie);
    expect(errors.status).toBe(200);
    expect(errors.body.total).toBeGreaterThanOrEqual(2);

    const audits = await request(app)
      .get('/api/admin/observability/audit-logs')
      .set('Cookie', adminCookie);
    expect(audits.status).toBe(200);
    expect(audits.body.total).toBeGreaterThanOrEqual(4);

    const owner = await request(app)
      .get('/api/admin/observability/error-logs')
      .set('Cookie', ownerCookie);
    expect(owner.status).toBe(403);
  });
});
