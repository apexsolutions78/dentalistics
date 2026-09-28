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
import {
  MISSED_CALL_CONFIG_META_KEY,
  loadMissedCallConfig,
} from '../src/automation/missedCall';
import {
  TELEPHONY_CONFIG_META_KEY,
  loadTelephonyConfig,
} from '../src/telephony/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';

const testHost = process.env.TEST_DB_HOST;
const HOUR = 3_600_000;
const SIGNING_SECRET = 'm12-test-secret-value';

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

interface CallEventRow extends mysql.RowDataPacket {
  id: number;
  organization_id: number;
  provider_key: string;
  provider_event_id: string;
  provider_status: string;
  call_outcome: string;
  caller_number: string;
  status: string;
  disposition: string;
  lead_id: number | null;
  patient_id: number | null;
  message_id: number | null;
  last_error: string | null;
  occurred_at: Date;
}

interface LeadRow extends mysql.RowDataPacket {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  source: string;
  status: string;
}

interface MessageRow extends mysql.RowDataPacket {
  id: number;
  recipient: string;
  body: string;
  status: string;
  message_type: string | null;
  template: string | null;
  idempotency_key: string;
  provider_error: string | null;
  lead_id: number | null;
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

describe.skipIf(testHost === undefined || testHost === '')('M12 acceptance: missed-call integration', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let app: Express;
  let server: Server;
  let serverPort: number;
  let logger: Logger & { entries: CapturedLog[] };

  let orgId: number;
  let orgBId: number;
  let ownerCookie: string;
  let recCookie: string;
  let phoneSeq = 0;

  const ownerEmail = 'owner.m12@apextest.local';
  const ownerPassword = 'OwnerM12Passw0rd!26x';
  const recEmail = 'rec.m12@apextest.local';
  const recPassword = 'RecM12Passw0rd!26x';

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
      [name, generateSiteKey()],
    );
    return row.insertId;
  }

  async function insertUser(organizationId: number, email: string, password: string, role: string): Promise<void> {
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

  function nextPhone(): string {
    phoneSeq += 1;
    return `15551230${String(phoneSeq).padStart(4, '0')}`;
  }

  interface PostOptions {
    secret?: string;
    form?: boolean;
    header?: string;
  }

  function postWebhook(
    provider: string,
    targetOrg: number,
    body: Record<string, unknown>,
    opts: PostOptions = {},
  ): request.Test {
    const pathName = `/api/webhooks/telephony/${provider}/${targetOrg}`;
    const fullUrl = `http://127.0.0.1:${serverPort}${pathName}`;
    const params = flatten(body);
    const signature = signParams(fullUrl, params, opts.secret ?? SIGNING_SECRET);
    const headerName =
      opts.header ?? (provider === 'twilio' ? 'x-twilio-signature' : 'x-mock-signature');
    let req = request(server).post(pathName).set(headerName, signature);
    if (opts.form === true) {
      req = req.type('form');
    }
    return req.send(body);
  }

  async function eventByProviderId(providerKey: string, eventId: string): Promise<CallEventRow | null> {
    const [rows] = await pool.query<CallEventRow[]>(
      'SELECT * FROM call_events WHERE provider_key = ? AND provider_event_id = ?',
      [providerKey, eventId],
    );
    return rows[0] ?? null;
  }

  async function leadsForPhone(phone: string): Promise<LeadRow[]> {
    const [rows] = await pool.query<LeadRow[]>(
      'SELECT id, first_name, last_name, phone, source, status FROM leads WHERE phone = ? ORDER BY id ASC',
      [phone],
    );
    return rows;
  }

  async function messageByKey(key: string): Promise<MessageRow | null> {
    const [rows] = await pool.query<MessageRow[]>(
      `SELECT id, recipient, body, status, message_type, template, idempotency_key, provider_error, lead_id
       FROM communication_messages WHERE idempotency_key = ?`,
      [key],
    );
    return rows[0] ?? null;
  }

  async function activityCount(leadId: number, action: string): Promise<number> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM lead_activities WHERE lead_id = ? AND action = ?',
      [leadId, action],
    );
    return rows[0]?.total ?? 0;
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

  async function setMissedCallConfig(patch: Record<string, unknown>): Promise<void> {
    const current = await loadMissedCallConfig(pool);
    const merged: Record<string, unknown> = { ...current, ...patch };
    await pool.query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [MISSED_CALL_CONFIG_META_KEY, JSON.stringify(merged)],
    );
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
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [TELEPHONY_CONFIG_META_KEY]);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [MISSED_CALL_CONFIG_META_KEY]);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['review_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['recall_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['noshow_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['reminder_config']);

    orgId = await insertOrg('M12 Clinic');
    orgBId = await insertOrg('M12 Clinic B');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');

    logger = captureLogger();
    app = createApp({ db: pool, logger });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    serverPort = (server.address() as AddressInfo).port;

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);

    await setTelephonyConfig({ enabled: true, signingSecret: SIGNING_SECRET });
  }, 30_000);

  afterAll(async () => {
    registerProvider(new MockProvider());
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('records an answered call without creating a lead or message', async () => {
    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-answered-1',
      status: 'answered',
      from: '+15551230101',
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(res.body.disposition).toBe('no_action');
    expect(res.body.leadId).toBeNull();

    const event = await eventByProviderId('mock', 'MC-answered-1');
    expect(event).not.toBeNull();
    expect(event?.call_outcome).toBe('ANSWERED');
    expect(event?.status).toBe('RECORDED');
    expect(event?.lead_id).toBeNull();
    expect(event?.message_id).toBeNull();

    const leads = await leadsForPhone('15551230101');
    expect(leads).toHaveLength(0);
  });

  it('creates a lead and sends the missed-call response for an unknown caller', async () => {
    const phone = '15551230102';
    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-missed-1',
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.disposition).toBe('lead_created');
    expect(res.body.leadId).toBeGreaterThan(0);
    expect(res.body.messageId).toBeGreaterThan(0);

    const leads = await leadsForPhone(phone);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.source).toBe('MISSED_CALL');
    expect(leads[0]?.status).toBe('NEW');
    expect(leads[0]?.first_name).toBe('Unknown');
    expect(leads[0]?.last_name).toBe(phone);

    const message = await messageByKey('missedcall:mock:MC-missed-1');
    expect(message).not.toBeNull();
    expect(message?.status).toBe('SENT');
    expect(message?.recipient).toBe(phone);
    expect(message?.message_type).toBe('missed_call_response');
    expect(message?.template).toBe('missed_call_response');
    expect(message?.body).toContain('M12 Clinic');
    expect(message?.body).not.toContain('{{');

    const event = await eventByProviderId('mock', 'MC-missed-1');
    expect(event?.call_outcome).toBe('MISSED');
    expect(event?.status).toBe('PROCESSED');
    expect(event?.lead_id).toBe(res.body.leadId);
    expect(event?.message_id).toBe(message?.id);
    expect(event?.last_error).toBeNull();

    expect(await activityCount(res.body.leadId as number, 'created')).toBe(1);
  });

  it('recovers from a rejected call like a missed call', async () => {
    const phone = '15551230103';
    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-rejected-1',
      status: 'rejected',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.disposition).toBe('lead_created');

    const event = await eventByProviderId('mock', 'MC-rejected-1');
    expect(event?.call_outcome).toBe('REJECTED');
    const leads = await leadsForPhone(phone);
    expect(leads).toHaveLength(1);
    expect(leads[0]?.source).toBe('MISSED_CALL');
    const message = await messageByKey('missedcall:mock:MC-rejected-1');
    expect(message?.status).toBe('SENT');
  });

  it('ignores a duplicate webhook without reprocessing', async () => {
    const phone = '15551230102';
    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-missed-1',
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');
    expect(res.body.callEventId).toBeGreaterThan(0);
    expect(res.body.leadId).toBeGreaterThan(0);

    const leads = await leadsForPhone(phone);
    expect(leads).toHaveLength(1);
    const [countRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM call_events WHERE provider_event_id = ?',
      ['MC-missed-1'],
    );
    expect(countRows[0]?.total).toBe(1);
    const [msgRows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM communication_messages WHERE idempotency_key = ?',
      ['missedcall:mock:MC-missed-1'],
    );
    expect(msgRows[0]?.total).toBe(1);
  });

  it('rejects invalid webhooks with the documented status codes', async () => {
    const badSignature = await postWebhook('mock', orgId, {
      eventId: 'MC-bad-sig',
      status: 'missed',
      from: '+15551230104',
      to: '+15550000001',
    }, { secret: 'wrong-secret' });
    expect(badSignature.status).toBe(401);

    const missingId = await postWebhook('mock', orgId, {
      status: 'missed',
      from: '+15551230104',
      to: '+15550000001',
    });
    expect(missingId.status).toBe(400);

    const unknownProvider = await postWebhook('notaprovider', orgId, {
      eventId: 'MC-unknown-provider',
      status: 'missed',
      from: '+15551230104',
      to: '+15550000001',
    });
    expect(unknownProvider.status).toBe(404);

    const unknownOrg = await postWebhook('mock', 999_999, {
      eventId: 'MC-unknown-org',
      status: 'missed',
      from: '+15551230104',
      to: '+15550000001',
    });
    expect(unknownOrg.status).toBe(404);

    const unsupported = await postWebhook('mock', orgId, {
      eventId: 'MC-bad-status',
      status: 'exploded',
      from: '+15551230104',
      to: '+15550000001',
    });
    expect(unsupported.status).toBe(400);

    const noSecret = await postWebhook('mock', orgId, {
      eventId: 'MC-no-secret',
      status: 'missed',
      from: '+15551230104',
      to: '+15550000001',
    }, { secret: '' });
    expect(noSecret.status).toBe(401);

    await setTelephonyConfig({ enabled: false });
    try {
      const disabled = await postWebhook('mock', orgId, {
        eventId: 'MC-disabled',
        status: 'missed',
        from: '+15551230104',
        to: '+15550000001',
      });
      expect(disabled.status).toBe(403);
    } finally {
      await setTelephonyConfig({ enabled: true });
    }

    expect(await leadsForPhone('15551230104')).toHaveLength(0);
    expect(await eventByProviderId('mock', 'MC-bad-sig')).toBeNull();
    expect(await eventByProviderId('mock', 'MC-disabled')).toBeNull();
  });

  it('links an existing patient without creating a lead and respects consent', async () => {
    const phone = nextPhone();
    const created = await request(app)
      .post(`/api/organizations/${orgId}/patients`)
      .set('Cookie', ownerCookie)
      .send({ firstName: 'Petra', lastName: 'M12', phone });
    expect(created.status).toBe(201);
    const patientId = created.body.patient.id as number;

    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-patient-1',
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.disposition).toBe('patient_contacted');
    expect(res.body.patientId).toBe(patientId);
    expect(res.body.leadId).toBeNull();

    expect(await leadsForPhone(phone)).toHaveLength(0);
    const message = await messageByKey('missedcall:mock:MC-patient-1');
    expect(message?.status).toBe('SENT');
    expect(message?.recipient).toBe(phone);
    expect(message?.body).toContain('Petra');

    const event = await eventByProviderId('mock', 'MC-patient-1');
    expect(event?.patient_id).toBe(patientId);
    expect(event?.lead_id).toBeNull();

    const optOutPhone = nextPhone();
    const optOut = await request(app)
      .post(`/api/organizations/${orgId}/patients`)
      .set('Cookie', ownerCookie)
      .send({ firstName: 'Otto', lastName: 'M12', phone: optOutPhone });
    expect(optOut.status).toBe(201);
    const optOutId = optOut.body.patient.id as number;
    const optedOut = await request(app)
      .patch(`/api/organizations/${orgId}/patients/${optOutId}`)
      .set('Cookie', ownerCookie)
      .send({ smsOptOut: true });
    expect(optedOut.status).toBe(200);
    expect(optedOut.body.patient.smsOptOut).toBe(true);

    const suppressed = await postWebhook('mock', orgId, {
      eventId: 'MC-patient-optout-1',
      status: 'missed',
      from: `+${optOutPhone}`,
      to: '+15550000001',
    });
    expect(suppressed.status).toBe(200);
    expect(suppressed.body.disposition).toBe('consent_suppressed');
    expect(suppressed.body.messageId).toBeNull();
    const optOutEvent = await eventByProviderId('mock', 'MC-patient-optout-1');
    expect(optOutEvent?.status).toBe('PROCESSED');
    expect(await messageByKey('missedcall:mock:MC-patient-optout-1')).toBeNull();
  });

  it('records activity on an existing active lead without creating a duplicate', async () => {
    const phone = nextPhone();
    const created = await request(app)
      .post(`/api/organizations/${orgId}/leads`)
      .set('Cookie', ownerCookie)
      .send({
        firstName: 'Lars',
        lastName: 'Existing',
        phone,
        source: 'WEBSITE',
        requestedService: 'Check-up',
      });
    expect(created.status).toBe(201);
    const leadId = created.body.lead.id as number;

    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-existing-lead-1',
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('processed');
    expect(res.body.disposition).toBe('lead_updated');
    expect(res.body.leadId).toBe(leadId);

    expect(await leadsForPhone(phone)).toHaveLength(1);
    expect(await activityCount(leadId, 'call_missed')).toBe(1);
    const message = await messageByKey('missedcall:mock:MC-existing-lead-1');
    expect(message?.status).toBe('SENT');
    expect(message?.lead_id).toBe(leadId);
  });

  it('survives a provider outage with a partial event and retries to sent', async () => {
    const phone = '999999999';
    const res = await postWebhook('mock', orgId, {
      eventId: 'MC-outage-1',
      status: 'missed',
      from: `+${phone}`,
      to: '+15550000001',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('partial');
    expect(res.body.disposition).toBe('lead_created');
    expect(res.body.messageId).toBeGreaterThan(0);

    let message = await messageByKey('missedcall:mock:MC-outage-1');
    expect(message?.status).toBe('FAILED');
    expect(message?.provider_error).toContain('mock_recipient_failure');

    const event = await eventByProviderId('mock', 'MC-outage-1');
    expect(event?.status).toBe('PARTIAL');
    expect(event?.last_error).toContain('failed');
    const callEventId = event?.id ?? 0;

    const recRetry = await request(app)
      .post(`/api/organizations/${orgId}/call-events/${callEventId}/retry`)
      .set('Cookie', recCookie)
      .send({});
    expect(recRetry.status).toBe(403);

    registerProvider(new MockProvider({ failOn: [] }));
    try {
      const retry = await request(app)
        .post(`/api/organizations/${orgId}/call-events/${callEventId}/retry`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(retry.status).toBe(200);
      expect(retry.body.action).toBe('sent');
      expect(retry.body.messageId).toBe(message?.id);
    } finally {
      registerProvider(new MockProvider());
    }

    message = await messageByKey('missedcall:mock:MC-outage-1');
    expect(message?.status).toBe('SENT');
    const healed = await eventByProviderId('mock', 'MC-outage-1');
    expect(healed?.status).toBe('PROCESSED');
    expect(healed?.last_error).toBeNull();
  }, 20_000);

  it('supports twilio form-encoded callbacks with documented statuses and signature', async () => {
    const answeredPhone = '15551230110';
    const answered = await postWebhook('twilio', orgId, {
      CallSid: 'CAtwilio-answered-1',
      CallStatus: 'completed',
      From: `+${answeredPhone}`,
      To: '+15550000002',
      Timestamp: '1700000000',
    }, { form: true });
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('recorded');
    const answeredEvent = await eventByProviderId('twilio', 'CAtwilio-answered-1');
    expect(answeredEvent?.call_outcome).toBe('ANSWERED');
    expect(answeredEvent?.occurred_at.getTime()).toBeLessThan(Date.now() - 300 * 24 * HOUR);

    const missedPhone = '15551230111';
    const missed = await postWebhook('twilio', orgId, {
      CallSid: 'CAtwilio-missed-1',
      CallStatus: 'no-answer',
      From: `+${missedPhone}`,
      To: '+15550000002',
      Timestamp: '1700000001',
    }, { form: true });
    expect(missed.status).toBe(200);
    expect(missed.body.status).toBe('processed');
    expect(missed.body.disposition).toBe('lead_created');
    const missedEvent = await eventByProviderId('twilio', 'CAtwilio-missed-1');
    expect(missedEvent?.call_outcome).toBe('MISSED');
    expect(missedEvent?.provider_status).toBe('no-answer');
    expect(await leadsForPhone(missedPhone)).toHaveLength(1);
    const message = await messageByKey('missedcall:twilio:CAtwilio-missed-1');
    expect(message?.status).toBe('SENT');

    const unsupported = await postWebhook('twilio', orgId, {
      CallSid: 'CAtwilio-bad-1',
      CallStatus: 'teleported',
      From: '+15551230112',
      To: '+15550000002',
    }, { form: true });
    expect(unsupported.status).toBe(400);
  });

  it('keeps tenant boundaries: org routing by URL and cross-org retry refused', async () => {
    const phoneB = '15551230120';
    const res = await postWebhook('mock', orgBId, {
      eventId: 'MC-tenant-b-1',
      status: 'missed',
      from: `+${phoneB}`,
      to: '+15550000003',
    });
    expect(res.status).toBe(200);
    expect(res.body.disposition).toBe('lead_created');
    const eventB = await eventByProviderId('mock', 'MC-tenant-b-1');
    expect(eventB?.organization_id).toBe(orgBId);

    const crossRetry = await request(app)
      .post(`/api/organizations/${orgBId}/call-events/${eventB?.id ?? 0}/retry`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(crossRetry.status).toBe(404);

    const [eventsForA] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM call_events WHERE organization_id = ? AND id = ?',
      [orgId, eventB?.id ?? 0],
    );
    expect(eventsForA[0]?.total).toBe(0);
  });

  it('skips the response message when missed-call automation is disabled but records the event', async () => {
    await setMissedCallConfig({ enabled: false });
    const phone = nextPhone();
    try {
      const res = await postWebhook('mock', orgId, {
        eventId: 'MC-disabled-auto-1',
        status: 'missed',
        from: `+${phone}`,
        to: '+15550000001',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('processed');
      expect(res.body.disposition).toBe('automation_disabled');
      expect(res.body.leadId).toBeGreaterThan(0);
      expect(res.body.messageId).toBeNull();
      expect(await leadsForPhone(phone)).toHaveLength(1);
      expect(await messageByKey('missedcall:mock:MC-disabled-auto-1')).toBeNull();
    } finally {
      await setMissedCallConfig({ enabled: true });
    }
  });

  it('returns 409 for retry of an event without a message', async () => {
    const event = await eventByProviderId('mock', 'MC-answered-1');
    expect(event).not.toBeNull();
    const res = await request(app)
      .post(`/api/organizations/${orgId}/call-events/${event?.id ?? 0}/retry`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(res.status).toBe(409);
  });
});
