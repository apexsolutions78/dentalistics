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
import type { ReceptionistWorkspace } from '../src/services/workspace';
import { WORKSPACE_DEFINITIONS, WORKSPACE_ITEM_CAP, WORKSPACE_TASK_CAP } from '../src/services/workspace';
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

function localDateIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

describe.skipIf(testHost === undefined || testHost === '')('M15 receptionist workspace API', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let adminCookie: string;
  let orgId: number;
  let orgBId: number;
  let orgCId: number;

  const ownerEmail = 'owner.m15@apextest.local';
  const ownerPassword = 'OwnerM15Passw0rd!26x';
  const recEmail = 'rec.m15@apextest.local';
  const recPassword = 'RecM15Passw0rd!26x';
  const ownerBEmail = 'owner.m15b@apextest.local';
  const ownerBPassword = 'OwnerM15BPassw0rd!26x';
  const adminEmail = 'admin.m15@apextest.local';
  const adminPassword = 'AdminM15Passw0rd!26x';

  let leadOldId: number;
  let leadNewId: number;
  let missedRecentId: number;
  let missedOlderId: number;
  let replyRecentId: number;
  let replyOlderId: number;
  let apptTodayId: number;
  let apptTomorrowId: number;
  let apptConfirmedId: number;
  let noShowRecentId: number;
  let recallOverdueId: number;
  let recallFutureId: number;

  async function insertOrg(name: string, timezone: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key, timezone) VALUES (?, ?, ?)',
      [name, generateSiteKey(), timezone],
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

  function workspaceUrl(org: number, suffix = ''): string {
    return `/api/organizations/${org}/receptionist/workspace${suffix}`;
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

    orgId = await insertOrg('M15 Clinic', 'UTC');
    orgBId = await insertOrg('M15 Clinic B', 'Pacific/Kiritimati');
    orgCId = await insertOrg('M15 Clinic C', 'Not/AZone');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
    await insertUser(null, adminEmail, adminPassword, 'admin');

    async function insertPatient(first: string, last: string, phone: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
        [orgId, first, last, phone],
      );
      return row.insertId;
    }

    const patientA = await insertPatient('Pati', 'EntA', '+15550100001');
    const patientB = await insertPatient('Pati', 'EntB', '+15550100002');

    async function insertLead(status: string, createdAt: string, phone: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO leads (organization_id, first_name, last_name, phone, source, status, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orgId, 'Lead', 'Fixture', phone, 'MANUAL', status, createdAt],
      );
      return row.insertId;
    }

    leadOldId = await insertLead('NEW', at(dateDaysAgo(5), 9), '+15550100011');
    leadNewId = await insertLead('NEW', at(dateDaysAgo(1), 9), '+15550100012');
    await insertLead('CONTACTED', at(dateDaysAgo(2), 9), '+15550100013');

    async function insertCallEvent(
      outcome: string,
      occurredAt: string,
      phone: string,
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO call_events (organization_id, provider_key, provider_event_id,' +
          ' provider_status, call_outcome, caller_number, called_number, occurred_at,' +
          ' disposition, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orgId,
          'm15mock',
          `m15-evt-${phone}-${occurredAt}`,
          'completed',
          outcome,
          phone,
          '+15550100000',
          occurredAt,
          'lead_created',
          '{}',
        ],
      );
      return row.insertId;
    }

    missedRecentId = await insertCallEvent('MISSED', at(dateDaysAgo(3), 10), '+15550100021');
    missedOlderId = await insertCallEvent('MISSED', at(dateDaysAgo(10), 11), '+15550100022');
    await insertCallEvent('REJECTED', at(dateDaysAgo(40), 11), '+15550100023');
    await insertCallEvent('ANSWERED', at(dateDaysAgo(2), 11), '+15550100024');

    async function insertInbound(
      createdAt: string,
      body: string,
      phone: string,
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO communication_messages (organization_id, channel, direction, recipient,' +
          ' body, status, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [orgId, 'SMS', 'INBOUND', phone, body, 'SENT', `m15-in-${phone}-${createdAt}`, createdAt],
      );
      return row.insertId;
    }

    replyRecentId = await insertInbound(at(dateDaysAgo(2), 9), 'short reply', '+15550100031');
    replyOlderId = await insertInbound(at(dateDaysAgo(5), 9), 'x'.repeat(300), '+15550100032');
    await insertInbound(at(dateDaysAgo(40), 9), 'old reply', '+15550100033');
    await pool.query(
      'INSERT INTO communication_messages (organization_id, channel, direction, recipient,' +
        ' body, status, idempotency_key, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        orgId,
        'SMS',
        'OUTBOUND',
        '+15550100034',
        'outbound body',
        'SENT',
        'm15-out-1',
        at(dateDaysAgo(1), 9),
        at(dateDaysAgo(1), 9),
      ],
    );

    async function insertAppointment(
      date: string,
      status: string,
      patient: number,
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO appointments (organization_id, patient_id, appointment_date,' +
          ' appointment_time, status) VALUES (?, ?, ?, ?, ?)',
        [orgId, patient, date, '10:00:00', status],
      );
      return row.insertId;
    }

    apptTodayId = await insertAppointment(dateDaysAgo(0), 'SCHEDULED', patientB);
    apptTomorrowId = await insertAppointment(dateDaysAgo(-1), 'SCHEDULED', patientA);
    apptConfirmedId = await insertAppointment(dateDaysAgo(-7), 'CONFIRMED', patientB);
    await insertAppointment(dateDaysAgo(5), 'SCHEDULED', patientA);
    await insertAppointment(dateDaysAgo(-3), 'CANCELLED', patientB);
    noShowRecentId = await insertAppointment(dateDaysAgo(2), 'NO_SHOW', patientA);
    await insertAppointment(dateDaysAgo(40), 'NO_SHOW', patientB);
    await insertAppointment(dateDaysAgo(2), 'COMPLETED', patientA);

    async function insertRecall(dueDate: string, status: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO recalls (organization_id, patient_id, due_date, status, opened_at)' +
          ' VALUES (?, ?, ?, ?, ?)',
        [orgId, patientA, dueDate, status, at(dateDaysAgo(30), 9)],
      );
      return row.insertId;
    }

    recallOverdueId = await insertRecall(dateDaysAgo(10), 'DUE');
    recallFutureId = await insertRecall(dateDaysAgo(-5), 'DUE');
    await insertRecall(dateDaysAgo(40), 'CONTACTED');
    await insertRecall(dateDaysAgo(40), 'BOOKED');

    for (let i = 0; i < 55; i += 1) {
      await pool.query(
        'INSERT INTO leads (organization_id, first_name, last_name, phone, source, status, created_at)' +
          ' VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          orgBId,
          'Cap',
          `Lead${i}`,
          `+155502${String(i).padStart(5, '0')}`,
          'MANUAL',
          'NEW',
          at(dateDaysAgo(3), 9),
        ],
      );
    }

    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger });

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
    adminCookie = await login(adminEmail, adminPassword);
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  async function fetchWorkspace(cookieValue: string, org = orgId): Promise<ReceptionistWorkspace> {
    const res = await request(app).get(workspaceUrl(org)).set('Cookie', cookieValue);
    expect(res.status).toBe(200);
    return res.body as ReceptionistWorkspace;
  }

  it('returns all seven queues with fixture-exact counts, ordering and scopes (receptionist)', async () => {
    const ws = await fetchWorkspace(recCookie);

    expect(ws.queues.newLeads.count).toBe(2);
    expect(ws.queues.newLeads.items.map((item) => item.id)).toEqual([leadOldId, leadNewId]);
    expect(ws.queues.newLeads.items[0]).toMatchObject({
      id: leadOldId,
      phone: '+15550100011',
      source: 'MANUAL',
    });

    expect(ws.queues.missedCalls.count).toBe(2);
    expect(ws.queues.missedCalls.items.map((item) => item.id)).toEqual([
      missedRecentId,
      missedOlderId,
    ]);
    expect(ws.queues.missedCalls.items[0]?.callOutcome).toBe('MISSED');

    expect(ws.queues.patientReplies.count).toBe(2);
    expect(ws.queues.patientReplies.items.map((item) => item.id)).toEqual([
      replyRecentId,
      replyOlderId,
    ]);
    expect(ws.queues.patientReplies.items[0]?.body).toBe('short reply');
    const longBody = ws.queues.patientReplies.items[1]?.body ?? '';
    expect(longBody).toHaveLength(160);
    expect(longBody.endsWith('...')).toBe(true);

    expect(ws.queues.upcomingAppointments.count).toBe(3);
    expect(ws.queues.upcomingAppointments.items.map((item) => item.id)).toEqual([
      apptTodayId,
      apptTomorrowId,
      apptConfirmedId,
    ]);
    expect(ws.queues.upcomingAppointments.items[0]?.needsConfirmation).toBe(true);
    expect(ws.queues.upcomingAppointments.items[2]?.needsConfirmation).toBe(false);
    expect(ws.queues.upcomingAppointments.items[1]?.patientName).toBe('Pati EntA');

    expect(ws.queues.noShows.count).toBe(1);
    expect(ws.queues.noShows.items[0]?.id).toBe(noShowRecentId);

    expect(ws.queues.recallOpportunities.count).toBe(2);
    expect(ws.queues.recallOpportunities.items.map((item) => item.id)).toEqual([
      recallOverdueId,
      recallFutureId,
    ]);
    expect(ws.queues.recallOpportunities.items[0]?.daysSinceDue).toBe(10);
    expect(ws.queues.recallOpportunities.items[1]?.daysSinceDue).toBe(-5);
  });

  it('derives tasks exactly per the documented union and plan priority order', async () => {
    const ws = await fetchWorkspace(recCookie);
    const tasks = ws.queues.tasks;

    expect(tasks.count).toBe(10);
    expect(tasks.items.map((item) => item.queue)).toEqual([
      'newLeads',
      'newLeads',
      'missedCalls',
      'missedCalls',
      'patientReplies',
      'patientReplies',
      'upcomingAppointments',
      'upcomingAppointments',
      'noShows',
      'recallOpportunities',
    ]);
    expect(tasks.items.map((item) => item.type)).toEqual([
      'contact-lead',
      'contact-lead',
      'missed-call',
      'missed-call',
      'patient-reply',
      'patient-reply',
      'confirm-appointment',
      'confirm-appointment',
      'no-show-follow-up',
      'recall-due',
    ]);
    expect(tasks.items[0]?.id).toBe(leadOldId);
    expect(tasks.items[6]?.id).toBe(apptTodayId);
    expect(tasks.items[7]?.id).toBe(apptTomorrowId);
    expect(tasks.items[8]?.id).toBe(noShowRecentId);
    expect(tasks.items[9]?.id).toBe(recallOverdueId);
    expect(tasks.items[0]?.label).toContain('New lead:');
    expect(tasks.items[6]?.label).toContain('Confirm appointment:');
    expect(tasks.items.every((item) => item.label.length > 0)).toBe(true);
  });

  it('enforces item caps with full counts (org B, 55 new leads)', async () => {
    const ws = await fetchWorkspace(ownerBCookie, orgBId);
    expect(ws.queues.newLeads.count).toBe(55);
    expect(ws.queues.newLeads.items).toHaveLength(WORKSPACE_ITEM_CAP);
    expect(ws.queues.tasks.count).toBe(55);
    expect(ws.queues.tasks.items).toHaveLength(WORKSPACE_TASK_CAP);
    expect(ws.queues.missedCalls.count).toBe(0);
    expect(ws.queues.upcomingAppointments.count).toBe(0);
  });

  it('documents every queue plus date basis, windows and caps', async () => {
    const ws = await fetchWorkspace(ownerCookie);
    expect(Object.keys(ws.definitions).sort()).toEqual(
      [
        'caps',
        'dateBasis',
        'queues.missedCalls',
        'queues.newLeads',
        'queues.noShows',
        'queues.patientReplies',
        'queues.recallOpportunities',
        'queues.tasks',
        'queues.upcomingAppointments',
        'windows',
      ].sort(),
    );
    expect(ws.definitions).toEqual(WORKSPACE_DEFINITIONS);
    for (const value of Object.values(ws.definitions)) {
      expect(value.length).toBeGreaterThan(20);
    }
  });

  it('echoes the clinic date per organization timezone', async () => {
    const wsA = await fetchWorkspace(ownerCookie, orgId);
    expect(wsA.timezone).toBe('UTC');
    expect(wsA.date).toBe(localDateIn('UTC'));

    const wsB = await fetchWorkspace(ownerBCookie, orgBId);
    expect(wsB.timezone).toBe('Pacific/Kiritimati');
    expect(wsB.date).toBe(localDateIn('Pacific/Kiritimati'));
    expect(Date.parse(wsA.generatedAt)).not.toBeNaN();
  });

  it('falls back to the UTC date basis for an invalid stored timezone', async () => {
    const res = await request(app).get(workspaceUrl(orgCId)).set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const wsC = res.body as ReceptionistWorkspace;
    expect(wsC.timezone).toBe('Not/AZone');
    expect(wsC.date).toBe(localDateIn('UTC'));
    expect(wsC.queues.newLeads.count).toBe(0);
  });

  it('allows the owner and platform administrator (all-member read)', async () => {
    const owner = await request(app).get(workspaceUrl(orgId)).set('Cookie', ownerCookie);
    expect(owner.status).toBe(200);
    const admin = await request(app).get(workspaceUrl(orgId)).set('Cookie', adminCookie);
    expect(admin.status).toBe(200);
  });

  it('returns 404 for a member of another organization', async () => {
    const res = await request(app).get(workspaceUrl(orgId)).set('Cookie', ownerBCookie);
    expect(res.status).toBe(404);
  });

  it('returns 401 without a session', async () => {
    const res = await request(app).get(workspaceUrl(orgId));
    expect(res.status).toBe(401);
  });
});
