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
import type { OutboundMessage } from '../src/communications/types';
import {
  WHATSAPP_CONFIG_META_KEY,
  loadWhatsAppConfig,
} from '../src/communications/whatsappConfig';
import {
  TELEPHONY_CONFIG_META_KEY,
  loadTelephonyConfig,
} from '../src/telephony/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';
import { runReminderTick } from '../src/automation/reminders';
import { runNoShowTick } from '../src/automation/noShow';
import { runRecallTick } from '../src/automation/recall';
import { runReviewRequestTick } from '../src/automation/reviewRequests';

const testHost = process.env.TEST_DB_HOST;
const TELEPHONY_SECRET = 'm20-telephony-secret-value';
const WHATSAPP_SECRET = 'm20-whatsapp-secret-value';
const REVIEW_URL = 'https://reviews.example.test/apex-m20';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

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

function inboundPayload(wamid: string, from: string, text: string): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-m20',
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: from, profile: { name: 'M20 Test' } }],
              messages: [
                {
                  from,
                  id: wamid,
                  timestamp: '1700000000',
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function ymdWhen(at: Date): { date: string; time: string } {
  const iso = at.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function dateOnly(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

interface MessageRow extends mysql.RowDataPacket {
  id: number;
  organization_id: number;
  channel: string;
  direction: string;
  recipient: string;
  body: string;
  status: string;
  message_type: string | null;
  idempotency_key: string;
  lead_id: number | null;
  sent_at: Date | null;
}

describe.skipIf(testHost === undefined || testHost === '')('M20 end-to-end production scenarios', () => {
  let pool: mysql.Pool;
  let app: Express;
  let server: Server;
  let serverPort: number;
  let logger: Logger & { entries: CapturedLog[] };
  let ownerCookie: string;
  let orgId: number;
  let mockProvider: MockProvider;

  const ownerEmail = 'owner.m20@apextest.local';
  const ownerPassword = 'OwnerM20Passw0rd!26x';

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

  async function setWhatsAppConfig(patch: Record<string, unknown>): Promise<void> {
    const current = await loadWhatsAppConfig(pool);
    const merged: Record<string, unknown> = { ...current, ...patch };
    await pool.query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [WHATSAPP_CONFIG_META_KEY, JSON.stringify(merged)],
    );
  }

  async function sqlAll<T extends mysql.RowDataPacket>(
    query: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const [rows] = await pool.query<T[]>(query, params);
    return rows;
  }

  async function messageByKey(key: string): Promise<MessageRow | null> {
    const rows = await sqlAll<MessageRow>(
      'SELECT * FROM communication_messages WHERE idempotency_key = ?',
      [key],
    );
    return rows[0] ?? null;
  }

  function attemptsTo(phone: string): OutboundMessage[] {
    return mockProvider.attempts.filter((entry) => entry.to === phone);
  }

  function postTelephony(body: Record<string, unknown>): request.Test {
    const pathName = `/api/webhooks/telephony/mock/${orgId}`;
    const fullUrl = `http://127.0.0.1:${serverPort}${pathName}`;
    const signature = signParams(fullUrl, flatten(body), TELEPHONY_SECRET);
    return request(server).post(pathName).set('x-mock-signature', signature).send(body);
  }

  function postWhatsApp(raw: string): request.Test {
    const pathName = `/api/webhooks/whatsapp/${orgId}`;
    const signature = `sha256=${createHmac('sha256', WHATSAPP_SECRET).update(raw, 'utf8').digest('hex')}`;
    return request(server)
      .post(pathName)
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw);
  }

  async function createPatientAs(first: string, last: string, phone: string): Promise<number> {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/patients`)
      .set('Cookie', ownerCookie)
      .send({ firstName: first, lastName: last, phone });
    expect(res.status).toBe(201);
    return res.body.patient.id as number;
  }

  async function createApptAs(body: Record<string, unknown>): Promise<number> {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/appointments`)
      .set('Cookie', ownerCookie)
      .send(body);
    expect(res.status).toBe(201);
    return res.body.appointment.id as number;
  }

  async function completeAs(appointmentId: number): Promise<request.Response> {
    return request(app)
      .post(`/api/organizations/${orgId}/appointments/${appointmentId}/complete`)
      .set('Cookie', ownerCookie)
      .send({});
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

    orgId = await insertOrg('M20 Clinic');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');

    mockProvider = new MockProvider();
    registerProvider(mockProvider);
    logger = captureLogger();
    app = createApp({ db: pool, logger });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    serverPort = (server.address() as AddressInfo).port;

    ownerCookie = await login(ownerEmail, ownerPassword);
    await setTelephonyConfig({ enabled: true, signingSecret: TELEPHONY_SECRET });
    await setWhatsAppConfig({
      enabled: true,
      verifyToken: 'm20-verify-token',
      appSecret: WHATSAPP_SECRET,
    });

    const orgRes = await request(app)
      .patch(`/api/organizations/${orgId}`)
      .set('Cookie', ownerCookie)
      .send({ reviewUrl: REVIEW_URL });
    expect(orgRes.status).toBe(200);
    expect(orgRes.body.organization.reviewUrl).toBe(REVIEW_URL);
  }, 30_000);

  afterAll(async () => {
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('scenario A: new lead through acknowledgement, receptionist queue, patient reply, booking, reminders, completion and review request', async () => {
    const phone = '15552000001';

    const leadRes = await request(app)
      .post(`/api/organizations/${orgId}/leads`)
      .set('Cookie', ownerCookie)
      .send({
        firstName: 'Anna',
        lastName: 'Alpha',
        phone,
        source: 'WEBSITE',
        requestedService: 'Cleaning',
      });
    expect(leadRes.status).toBe(201);
    const leadId = leadRes.body.lead.id as number;
    expect(leadRes.body.lead.status).toBe('NEW');

    const ack = await messageByKey(`ack:lead:${leadId}`);
    expect(ack).not.toBeNull();
    expect(ack?.status).toBe('SENT');
    expect(ack?.message_type).toBe('lead_acknowledgement');
    expect(ack?.direction).toBe('OUTBOUND');
    expect(ack?.recipient).toBe(phone);
    expect(ack?.lead_id).toBe(leadId);
    expect(attemptsTo(phone)).toHaveLength(1);

    const wsRes = await request(app)
      .get(`/api/organizations/${orgId}/receptionist/workspace`)
      .set('Cookie', ownerCookie);
    expect(wsRes.status).toBe(200);
    const newLeads = wsRes.body.queues.newLeads.items as Array<{ id: number; phone: string }>;
    expect(newLeads.some((item) => item.id === leadId && item.phone === phone)).toBe(true);

    const wamid = 'wamid.m20.scenarioA.reply1';
    const replyRes = await postWhatsApp(
      JSON.stringify(inboundPayload(wamid, phone, 'Yes, please book me in')),
    );
    expect(replyRes.status).toBe(200);
    expect(replyRes.body.inbound.created).toBe(1);
    const inbound = await messageByKey(`whatsapp:${wamid}`);
    expect(inbound).not.toBeNull();
    expect(inbound?.direction).toBe('INBOUND');
    expect(inbound?.status).toBe('RECEIVED');
    expect(inbound?.message_type).toBe('patient_reply');
    expect(inbound?.lead_id).toBe(leadId);
    expect(inbound?.recipient).toBe(phone);
    expect(attemptsTo(phone)).toHaveLength(1);

    const patientId = await createPatientAs('Anna', 'Alpha', phone);
    const bookedAt = new Date(Date.now() + 50 * HOUR_MS);
    const apptRes = await request(app)
      .post(`/api/organizations/${orgId}/appointments`)
      .set('Cookie', ownerCookie)
      .send({ patientId, leadId, ...ymdWhen(bookedAt), service: 'Cleaning' });
    expect(apptRes.status).toBe(201);
    const apptId = apptRes.body.appointment.id as number;
    expect(apptRes.body.appointment.status).toBe('SCHEDULED');
    const reminderRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT offset_hours, status FROM appointment_reminders WHERE appointment_id = ? ORDER BY offset_hours',
      [apptId],
    );
    expect(reminderRows.map((row) => row.offset_hours)).toEqual([2, 24, 48]);
    expect(reminderRows.every((row) => row.status === 'PENDING')).toBe(true);

    await pool.query(
      'UPDATE appointment_reminders SET scheduled_at = UTC_TIMESTAMP() WHERE appointment_id = ?',
      [apptId],
    );
    const reminderTick = await runReminderTick(pool, logger, { batchSize: 50 });
    expect(reminderTick.processed).toBe(3);
    expect(reminderTick.sent).toBe(3);
    expect(reminderTick.failed).toBe(0);
    expect(attemptsTo(phone)).toHaveLength(4);
    const sentReminders = await sqlAll<mysql.RowDataPacket>(
      `SELECT COUNT(*) AS n FROM appointment_reminders WHERE appointment_id = ? AND status = 'SENT'`,
      [apptId],
    );
    expect(Number(sentReminders[0]?.n ?? 0)).toBe(3);

    const completeRes = await completeAs(apptId);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.appointment.status).toBe('COMPLETED');

    const reviewRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT id, status, review_url, scheduled_at, message_id FROM review_requests WHERE appointment_id = ?',
      [apptId],
    );
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]?.status).toBe('PENDING');
    expect(reviewRows[0]?.review_url).toBe(REVIEW_URL);
    expect(reviewRows[0]?.message_id).toBeNull();
    const reviewScheduledAt = new Date(
      reviewRows[0]?.scheduled_at as string | number | Date,
    ).getTime();
    expect(reviewScheduledAt).toBeGreaterThanOrEqual(Date.now() + 23 * HOUR_MS);
    expect(reviewScheduledAt).toBeLessThanOrEqual(Date.now() + 25 * HOUR_MS);

    const recallRows = await sqlAll<mysql.RowDataPacket>(
      `SELECT id, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
              anchor_appointment_id, last_contacted_at, closed_at
       FROM recalls WHERE patient_id = ? AND organization_id = ?`,
      [patientId, orgId],
    );
    expect(recallRows).toHaveLength(1);
    expect(recallRows[0]?.status).toBe('DUE');
    const apptDate = ymdWhen(bookedAt).date;
    const expectedDue = new Date(
      new Date(`${apptDate}T00:00:00Z`).getTime() + 180 * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    expect(recallRows[0]?.due_date).toBe(expectedDue);
    expect(recallRows[0]?.anchor_appointment_id).toBe(apptId);
    expect(recallRows[0]?.last_contacted_at).toBeNull();
    expect(recallRows[0]?.closed_at).toBeNull();
    const recallId = Number(recallRows[0]?.id);
    const recallMsgRows = await sqlAll<mysql.RowDataPacket>(
      `SELECT phase, status, scheduled_at FROM recall_messages WHERE recall_id = ?
       ORDER BY FIELD(phase, 'INITIAL', 'FOLLOW_UP')`,
      [recallId],
    );
    expect(recallMsgRows).toHaveLength(2);
    expect(recallMsgRows[0]?.phase).toBe('INITIAL');
    expect(recallMsgRows[0]?.status).toBe('PENDING');
    expect(recallMsgRows[1]?.phase).toBe('FOLLOW_UP');
    expect(recallMsgRows[1]?.status).toBe('PENDING');
    expect(
      new Date(recallMsgRows[1]?.scheduled_at as string | number | Date).getTime(),
    ).toBeGreaterThan(Date.now());

    const reviewId = Number(reviewRows[0]?.id);
    await pool.query('UPDATE review_requests SET scheduled_at = UTC_TIMESTAMP() WHERE id = ?', [
      reviewId,
    ]);
    const reviewTick = await runReviewRequestTick(pool, logger, { batchSize: 20 });
    expect(reviewTick.sent).toBe(1);
    expect(attemptsTo(phone)).toHaveLength(5);
    const reviewAfter = await sqlAll<mysql.RowDataPacket>(
      'SELECT status, message_id FROM review_requests WHERE id = ?',
      [reviewId],
    );
    expect(reviewAfter[0]?.status).toBe('SENT');
    expect(reviewAfter[0]?.message_id).not.toBeNull();
    const reviewMsgCount = await sqlAll<mysql.RowDataPacket>(
      `SELECT COUNT(*) AS n FROM communication_messages
       WHERE message_type = 'review_request' AND recipient = ?`,
      [phone],
    );
    expect(Number(reviewMsgCount[0]?.n ?? 0)).toBe(1);
  }, 30_000);

  it('scenario B: missed call through lead creation, response message, patient reply and appointment booking', async () => {
    const phone = '15552000002';
    const eventId = 'MC-M20-SCENARIO-B-1';
    const callRes = await postTelephony({
      eventId,
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(callRes.status).toBe(200);
    expect(callRes.body.status).toBe('processed');
    expect(callRes.body.disposition).toBe('lead_created');
    const leadId = callRes.body.leadId as number;
    expect(leadId).toBeGreaterThan(0);
    expect(callRes.body.messageId).toBeGreaterThan(0);

    const leadRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT phone, source, status FROM leads WHERE id = ?',
      [leadId],
    );
    expect(leadRows[0]?.phone).toBe(phone);
    expect(leadRows[0]?.source).toBe('MISSED_CALL');
    expect(leadRows[0]?.status).toBe('NEW');

    const mcMessage = await messageByKey(`missedcall:mock:${eventId}`);
    expect(mcMessage).not.toBeNull();
    expect(mcMessage?.status).toBe('SENT');
    expect(mcMessage?.message_type).toBe('missed_call_response');
    expect(mcMessage?.lead_id).toBe(leadId);
    expect(mcMessage?.recipient).toBe(phone);
    expect(attemptsTo(phone)).toHaveLength(1);

    const wamid = 'wamid.m20.scenarioB.reply1';
    const replyRes = await postWhatsApp(
      JSON.stringify(inboundPayload(wamid, phone, 'I can come Thursday')),
    );
    expect(replyRes.status).toBe(200);
    expect(replyRes.body.inbound.created).toBe(1);
    const inbound = await messageByKey(`whatsapp:${wamid}`);
    expect(inbound).not.toBeNull();
    expect(inbound?.direction).toBe('INBOUND');
    expect(inbound?.status).toBe('RECEIVED');
    expect(inbound?.message_type).toBe('patient_reply');
    expect(inbound?.lead_id).toBe(leadId);
    expect(attemptsTo(phone)).toHaveLength(1);

    const patientId = await createPatientAs('Bob', 'Beta', phone);
    const bookedAt = new Date(Date.now() + 2 * DAY_MS + 3 * HOUR_MS);
    const apptId = await createApptAs({
      patientId,
      leadId,
      ...ymdWhen(bookedAt),
      service: 'Examination',
    });
    const apptRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT status FROM appointments WHERE id = ?',
      [apptId],
    );
    expect(apptRows[0]?.status).toBe('SCHEDULED');
    const reminderRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT COUNT(*) AS n FROM appointment_reminders WHERE appointment_id = ?',
      [apptId],
    );
    expect(Number(reminderRows[0]?.n ?? 0)).toBe(3);
    expect(attemptsTo(phone)).toHaveLength(1);
  }, 30_000);

  it('scenario C: no-show through recovery message, rebooking and workflow stop', async () => {
    const phone = '15552000003';
    const patientId = await createPatientAs('Cara', 'Cee', phone);
    const bookedAt = new Date(Date.now() + 2 * DAY_MS + 5 * HOUR_MS);
    const apptId = await createApptAs({ patientId, ...ymdWhen(bookedAt), service: 'Cleaning' });

    const noShowRes = await request(app)
      .post(`/api/organizations/${orgId}/appointments/${apptId}/no-show`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(noShowRes.status).toBe(200);
    expect(noShowRes.body.appointment.status).toBe('NO_SHOW');

    const caseRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT id, status, rebooked_appointment_id, closed_at FROM no_show_cases WHERE appointment_id = ?',
      [apptId],
    );
    expect(caseRows).toHaveLength(1);
    expect(caseRows[0]?.status).toBe('OPEN');
    expect(caseRows[0]?.closed_at).toBeNull();
    const caseId = Number(caseRows[0]?.id);

    const nsMessageRows = await sqlAll<mysql.RowDataPacket>(
      `SELECT phase, status, message_id, scheduled_at FROM no_show_messages
       WHERE case_id = ? ORDER BY FIELD(phase, 'INITIAL', 'FOLLOW_UP')`,
      [caseId],
    );
    expect(nsMessageRows).toHaveLength(2);
    expect(nsMessageRows[0]?.phase).toBe('INITIAL');
    expect(nsMessageRows[0]?.status).toBe('SENT');
    expect(nsMessageRows[0]?.message_id).not.toBeNull();
    expect(nsMessageRows[1]?.phase).toBe('FOLLOW_UP');
    expect(nsMessageRows[1]?.status).toBe('PENDING');
    expect(
      new Date(nsMessageRows[1]?.scheduled_at as string | number | Date).getTime(),
    ).toBeGreaterThan(Date.now());
    expect(attemptsTo(phone)).toHaveLength(1);
    const nsMessage = await sqlAll<mysql.RowDataPacket>(
      `SELECT status FROM communication_messages
       WHERE message_type = 'no_show_message' AND recipient = ?`,
      [phone],
    );
    expect(nsMessage).toHaveLength(1);
    expect(nsMessage[0]?.status).toBe('SENT');

    const pendingReminders = await sqlAll<mysql.RowDataPacket>(
      `SELECT COUNT(*) AS n FROM appointment_reminders
       WHERE appointment_id = ? AND status IN ('PENDING', 'SENDING')`,
      [apptId],
    );
    expect(Number(pendingReminders[0]?.n ?? 0)).toBe(0);

    const rebookedAt = new Date(Date.now() + 3 * DAY_MS + 5 * HOUR_MS);
    const rebookRes = await request(app)
      .post(`/api/organizations/${orgId}/appointments/${apptId}/rebook`)
      .set('Cookie', ownerCookie)
      .send(ymdWhen(rebookedAt));
    expect(rebookRes.status).toBe(200);
    const newId = rebookRes.body.appointment.id as number;
    expect(rebookRes.body.appointment.status).toBe('SCHEDULED');
    expect(rebookRes.body.rebookedFrom.id).toBe(apptId);
    const newApptRows = await sqlAll<mysql.RowDataPacket>(
      'SELECT previous_appointment_id, status FROM appointments WHERE id = ?',
      [newId],
    );
    expect(newApptRows[0]?.previous_appointment_id).toBe(apptId);
    expect(newApptRows[0]?.status).toBe('SCHEDULED');

    const caseAfter = await sqlAll<mysql.RowDataPacket>(
      'SELECT status, rebooked_appointment_id, closed_at FROM no_show_cases WHERE id = ?',
      [caseId],
    );
    expect(caseAfter[0]?.status).toBe('REBOOKED');
    expect(caseAfter[0]?.rebooked_appointment_id).toBe(newId);
    expect(caseAfter[0]?.closed_at).not.toBeNull();
    const rebookReminders = await sqlAll<mysql.RowDataPacket>(
      'SELECT COUNT(*) AS n FROM appointment_reminders WHERE appointment_id = ?',
      [newId],
    );
    expect(Number(rebookReminders[0]?.n ?? 0)).toBe(3);

    await pool.query(
      `UPDATE no_show_messages SET scheduled_at = UTC_TIMESTAMP()
       WHERE case_id = ? AND phase = 'FOLLOW_UP'`,
      [caseId],
    );
    const stopTick = await runNoShowTick(pool, logger, { batchSize: 20 });
    expect(stopTick.sent).toBe(0);
    expect(attemptsTo(phone)).toHaveLength(1);
    const followUpMessages = await sqlAll<mysql.RowDataPacket>(
      `SELECT COUNT(*) AS n FROM communication_messages
       WHERE message_type = 'no_show_follow_up' AND recipient = ?`,
      [phone],
    );
    expect(Number(followUpMessages[0]?.n ?? 0)).toBe(0);
    const followUpRow = await sqlAll<mysql.RowDataPacket>(
      `SELECT status FROM no_show_messages WHERE case_id = ? AND phase = 'FOLLOW_UP'`,
      [caseId],
    );
    expect(followUpRow[0]?.status).not.toBe('SENT');
  }, 30_000);

  it('scenario D: overdue patient through recall message, follow-up, booking and recall closure', async () => {
    const phone = '15552000004';
    const patientId = await createPatientAs('Dan', 'Delta', phone);
    const apptId = await createApptAs({
      patientId,
      date: dateOnly(-190),
      time: '10:00',
      service: 'Hygiene',
    });

    const completeRes = await completeAs(apptId);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.appointment.status).toBe('COMPLETED');

    const recallRows = await sqlAll<mysql.RowDataPacket>(
      `SELECT id, status, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
              anchor_appointment_id, last_contacted_at, closed_at
       FROM recalls WHERE patient_id = ? AND organization_id = ?`,
      [patientId, orgId],
    );
    expect(recallRows).toHaveLength(1);
    expect(recallRows[0]?.status).toBe('CONTACTED');
    expect(recallRows[0]?.due_date).toBe(dateOnly(-10));
    expect(recallRows[0]?.anchor_appointment_id).toBe(apptId);
    expect(recallRows[0]?.last_contacted_at).not.toBeNull();
    expect(recallRows[0]?.closed_at).toBeNull();
    const recallId = Number(recallRows[0]?.id);

    const recallMsgs = await sqlAll<mysql.RowDataPacket>(
      `SELECT phase, status, message_id FROM recall_messages WHERE recall_id = ?
       ORDER BY FIELD(phase, 'INITIAL', 'FOLLOW_UP')`,
      [recallId],
    );
    expect(recallMsgs).toHaveLength(2);
    expect(recallMsgs[0]?.phase).toBe('INITIAL');
    expect(recallMsgs[0]?.status).toBe('SENT');
    expect(recallMsgs[0]?.message_id).not.toBeNull();
    expect(recallMsgs[1]?.phase).toBe('FOLLOW_UP');
    expect(recallMsgs[1]?.status).toBe('PENDING');
    expect(attemptsTo(phone)).toHaveLength(1);
    const recallMessage = await sqlAll<mysql.RowDataPacket>(
      `SELECT status FROM communication_messages
       WHERE message_type = 'recall_message' AND recipient = ?`,
      [phone],
    );
    expect(recallMessage).toHaveLength(1);
    expect(recallMessage[0]?.status).toBe('SENT');

    const followUpTick = await runRecallTick(pool, logger, { batchSize: 50 });
    expect(followUpTick.sent).toBe(1);
    expect(attemptsTo(phone)).toHaveLength(2);
    const followUpMessages = await sqlAll<mysql.RowDataPacket>(
      `SELECT status FROM communication_messages
       WHERE message_type = 'recall_follow_up' AND recipient = ?`,
      [phone],
    );
    expect(followUpMessages).toHaveLength(1);
    expect(followUpMessages[0]?.status).toBe('SENT');
    const recallAfterFollowUp = await sqlAll<mysql.RowDataPacket>(
      'SELECT status FROM recalls WHERE id = ?',
      [recallId],
    );
    expect(recallAfterFollowUp[0]?.status).toBe('CONTACTED');

    const bookedAt = new Date(Date.now() + 30 * DAY_MS);
    const bookId = await createApptAs({
      patientId,
      ...ymdWhen(bookedAt),
      service: 'Hygiene',
    });

    const closedRecall = await sqlAll<mysql.RowDataPacket>(
      'SELECT status, closed_at, rebooked_appointment_id FROM recalls WHERE id = ?',
      [recallId],
    );
    expect(closedRecall[0]?.status).toBe('BOOKED');
    expect(closedRecall[0]?.closed_at).not.toBeNull();
    expect(closedRecall[0]?.rebooked_appointment_id).toBe(bookId);

    const stopTick = await runRecallTick(pool, logger, { batchSize: 50 });
    expect(stopTick.sent).toBe(0);
    expect(attemptsTo(phone)).toHaveLength(2);
    const pendingRecallMessages = await sqlAll<mysql.RowDataPacket>(
      'SELECT COUNT(*) AS n FROM recall_messages WHERE recall_id = ? AND status = ?',
      [recallId, 'PENDING'],
    );
    expect(Number(pendingRecallMessages[0]?.n ?? 0)).toBe(0);
    const recallFinal = await sqlAll<mysql.RowDataPacket>(
      'SELECT status FROM recalls WHERE id = ?',
      [recallId],
    );
    expect(recallFinal[0]?.status).toBe('BOOKED');
  }, 30_000);
});
