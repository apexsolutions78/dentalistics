import 'dotenv/config';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { WhatsAppProvider } from '../src/communications/whatsappProvider';
import {
  WHATSAPP_CONFIG_META_KEY,
  loadWhatsAppConfig,
} from '../src/communications/whatsappConfig';
import { getProvider, registerProvider } from '../src/communications/registry';
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
import { handleInboundMessage, sendTemplateMessage } from '../src/services/messages';
import { generateSiteKey } from '../src/security/siteKey';

const testHost = process.env.TEST_DB_HOST;
const APP_SECRET = 'm13-app-secret-value';
const VERIFY_TOKEN = 'm13-verify-token';
const TELEPHONY_SECRET = 'm13-telephony-secret';

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

function signBody(raw: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
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
  template: string | null;
  idempotency_key: string;
  provider_key: string | null;
  provider_message_id: string | null;
  provider_error: string | null;
  lead_id: number | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
}

function inboundPayload(wamid: string, from: string, text: string): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: from, profile: { name: 'M13 Test' } }],
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

function statusPayload(wamid: string, status: string): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              statuses: [
                {
                  id: wamid,
                  status,
                  timestamp: '1700000001',
                  recipient_id: '15551234567',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe.skipIf(testHost === undefined || testHost === '')('M13 acceptance: WhatsApp integration', () => {
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
  let ownerBCookie: string;
  let adminCookie: string;

  const ownerEmail = 'owner.m13@apextest.local';
  const ownerPassword = 'OwnerM13Passw0rd!26x';
  const recEmail = 'rec.m13@apextest.local';
  const recPassword = 'RecM13Passw0rd!26x';
  const ownerBEmail = 'owner.m13b@apextest.local';
  const ownerBPassword = 'OwnerM13BPassw0rd!26x';
  const adminEmail = 'admin.m13@apextest.local';
  const adminPassword = 'AdminM13Passw0rd!26x';

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

  async function setWhatsAppConfig(patch: Record<string, unknown>): Promise<void> {
    const current = await loadWhatsAppConfig(pool);
    const merged: Record<string, unknown> = { ...current, ...patch };
    await pool.query(
      `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [WHATSAPP_CONFIG_META_KEY, JSON.stringify(merged)],
    );
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

  function postWebhook(raw: string, opts: { signature?: string | null } = {}): request.Test {
    const pathName = `/api/webhooks/whatsapp/${orgId}`;
    const req = request(server).post(pathName).set('Content-Type', 'application/json');
    if (opts.signature !== null) {
      req.set('X-Hub-Signature-256', opts.signature ?? signBody(raw, APP_SECRET));
    }
    return req.send(raw);
  }

  async function messageByKey(key: string): Promise<MessageRow | null> {
    const [rows] = await pool.query<MessageRow[]>(
      'SELECT * FROM communication_messages WHERE idempotency_key = ?',
      [key],
    );
    return rows[0] ?? null;
  }

  async function setCreatedAt(key: string, ageHours: number): Promise<void> {
    await pool.query(
      'UPDATE communication_messages SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE idempotency_key = ?',
      [ageHours, key],
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
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [WHATSAPP_CONFIG_META_KEY]);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [TELEPHONY_CONFIG_META_KEY]);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [MISSED_CALL_CONFIG_META_KEY]);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['review_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['recall_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['noshow_config']);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['reminder_config']);

    orgId = await insertOrg('M13 Clinic');
    orgBId = await insertOrg('M13 Clinic B');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
    await insertUser(null, adminEmail, adminPassword, 'admin');

    logger = captureLogger();
    app = createApp({ db: pool, logger });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    serverPort = (server.address() as AddressInfo).port;

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
    adminCookie = await login(adminEmail, adminPassword);

    await setWhatsAppConfig({
      enabled: true,
      verifyToken: VERIFY_TOKEN,
      appSecret: APP_SECRET,
    });
    await setTelephonyConfig({ enabled: true, signingSecret: TELEPHONY_SECRET });
  }, 30_000);

  afterAll(async () => {
    registerProvider(new MockProvider());
    vi.unstubAllGlobals();
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('sends a WhatsApp template message and records the provider contract', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const stubFetch = async (input: unknown, init?: unknown): Promise<unknown> => {
      const rawInit = (init ?? {}) as { body?: unknown };
      calls.push({
        url: String(input),
        body: JSON.parse(String(rawInit.body)) as Record<string, unknown>,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.m13.stub.0001' }] }),
        text: async () => '',
      };
    };
    vi.stubGlobal('fetch', stubFetch as unknown as typeof fetch);

    try {
      const phone = '15551230500';
      const provider = new WhatsAppProvider(async () => ({
        accessToken: 'stub-token',
        phoneNumberId: '424242',
        apiVersion: 'v26.0',
      }));
      const result = await sendTemplateMessage(pool, logger, provider, {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: phone,
        templateName: 'greeting_v1',
        templateText: 'Hello {{name}}, your appointment is ready.',
        variables: { name: 'Ana' },
        idempotencyKey: 'm13:template:greeting',
      });
      expect(result.outcome).toBe('sent');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/424242/messages');
      expect(calls[0]?.body.messaging_product).toBe('whatsapp');
      expect(calls[0]?.body.type).toBe('text');
      expect(calls[0]?.body.to).toBe(phone);
      const text = calls[0]?.body.text as { body?: string } | undefined;
      expect(text?.body).toBe('Hello Ana, your appointment is ready.');

      const row = await messageByKey('m13:template:greeting');
      expect(row).not.toBeNull();
      expect(row?.organization_id).toBe(orgId);
      expect(row?.channel).toBe('WHATSAPP');
      expect(row?.direction).toBe('OUTBOUND');
      expect(row?.status).toBe('SENT');
      expect(row?.recipient).toBe(phone);
      expect(row?.template).toBe('greeting_v1');
      expect(row?.provider_key).toBe('whatsapp');
      expect(row?.provider_message_id).toBe('wamid.m13.stub.0001');
      expect(row?.provider_error).toBeNull();
      expect(row?.sent_at).not.toBeNull();
      expect(row?.delivered_at).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('applies delivery statuses from webhook events with idempotent handling', async () => {
    const phone = '15551230501';
    const keys: Record<string, string> = {
      delivered: 'm13:out:delivered',
      failed: 'm13:out:failed',
      sentOnly: 'm13:out:sentonly',
    };
    for (const [name, key] of Object.entries(keys)) {
      const result = await sendTemplateMessage(pool, logger, getProvider('mock'), {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: phone,
        templateName: 'status_probe',
        templateText: `Status probe ${name}`,
        variables: {},
        idempotencyKey: key,
      });
      expect(result.outcome).toBe('sent');
    }

    const deliveredRow = await messageByKey(keys.delivered as string);
    const failedRow = await messageByKey(keys.failed as string);
    const sentOnlyRow = await messageByKey(keys.sentOnly as string);
    expect(deliveredRow?.provider_message_id).not.toBeNull();
    expect(failedRow?.provider_message_id).not.toBeNull();
    expect(sentOnlyRow?.provider_message_id).not.toBeNull();

    const deliveredWamid = String(deliveredRow?.provider_message_id);
    const failedWamid = String(failedRow?.provider_message_id);
    const sentOnlyWamid = String(sentOnlyRow?.provider_message_id);

    const delivered = await postWebhook(JSON.stringify(statusPayload(deliveredWamid, 'delivered')));
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('ok');
    expect(delivered.body.statuses.applied).toBe(1);
    let row = await messageByKey(keys.delivered as string);
    expect(row?.status).toBe('DELIVERED');
    expect(row?.delivered_at).not.toBeNull();

    const duplicateStatus = await postWebhook(
      JSON.stringify(statusPayload(deliveredWamid, 'delivered')),
    );
    expect(duplicateStatus.status).toBe(200);
    expect(duplicateStatus.body.statuses.applied).toBe(0);
    expect(duplicateStatus.body.statuses.ignored).toBe(1);
    row = await messageByKey(keys.delivered as string);
    expect(row?.status).toBe('DELIVERED');

    const failed = await postWebhook(JSON.stringify(statusPayload(failedWamid, 'failed')));
    expect(failed.status).toBe(200);
    expect(failed.body.statuses.applied).toBe(1);
    row = await messageByKey(keys.failed as string);
    expect(row?.status).toBe('UNDELIVERED');
    expect(row?.delivered_at).toBeNull();

    const sentEvent = await postWebhook(JSON.stringify(statusPayload(sentOnlyWamid, 'sent')));
    expect(sentEvent.status).toBe(200);
    expect(sentEvent.body.statuses.applied).toBe(0);
    expect(sentEvent.body.statuses.ignored).toBe(1);
    row = await messageByKey(keys.sentOnly as string);
    expect(row?.status).toBe('SENT');

    const readEvent = await postWebhook(JSON.stringify(statusPayload(sentOnlyWamid, 'read')));
    expect(readEvent.status).toBe(200);
    expect(readEvent.body.statuses.applied).toBe(1);
    row = await messageByKey(keys.sentOnly as string);
    expect(row?.status).toBe('DELIVERED');

    const unknown = await postWebhook(
      JSON.stringify(statusPayload('wamid.does.not.exist', 'delivered')),
    );
    expect(unknown.status).toBe(200);
    expect(unknown.body.statuses.applied).toBe(0);
    expect(unknown.body.statuses.ignored).toBe(1);
  });

  it('stores an incoming WhatsApp reply and links the active lead', async () => {
    const phone = '15551230502';
    const leadRes = await request(app)
      .post(`/api/organizations/${orgId}/leads`)
      .set('Cookie', ownerCookie)
      .send({
        firstName: 'Ines',
        lastName: 'M13',
        phone,
        source: 'WEBSITE',
        requestedService: 'Check-up',
      });
    expect(leadRes.status).toBe(201);
    const leadId = leadRes.body.lead.id as number;

    const res = await postWebhook(
      JSON.stringify(inboundPayload('wamid.m13.inbound.0001', phone, 'I would like to rebook')),
    );
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.inbound.created).toBe(1);
    expect(res.body.inbound.duplicate).toBe(0);
    expect(res.body.inbound.errors).toBe(0);

    const row = await messageByKey('whatsapp:wamid.m13.inbound.0001');
    expect(row).not.toBeNull();
    expect(row?.organization_id).toBe(orgId);
    expect(row?.channel).toBe('WHATSAPP');
    expect(row?.direction).toBe('INBOUND');
    expect(row?.status).toBe('RECEIVED');
    expect(row?.message_type).toBe('patient_reply');
    expect(row?.recipient).toBe(phone);
    expect(row?.body).toBe('I would like to rebook');
    expect(row?.lead_id).toBe(leadId);

    const imagePayload = inboundPayload('wamid.m13.inbound.image', phone, 'unused');
    const imageEntry = (
      (imagePayload.entry as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).changes as Array<Record<string, unknown>>;
    const imageValue = (imageEntry[0] as Record<string, unknown>).value as Record<string, unknown>;
    (imageValue.messages as Array<Record<string, unknown>>)[0] = {
      from: phone,
      id: 'wamid.m13.inbound.image',
      timestamp: '1700000002',
      type: 'image',
    };
    const image = await postWebhook(JSON.stringify(imagePayload));
    expect(image.status).toBe(200);
    expect(image.body.inbound.ignored).toBe(1);
    expect(await messageByKey('whatsapp:wamid.m13.inbound.image')).toBeNull();
  });

  it('verifies webhook setup and rejects invalid signatures', async () => {
    const basePath = `/api/webhooks/whatsapp/${orgId}`;

    const valid = await request(app).get(
      `${basePath}?hub.mode=subscribe&hub.challenge=CHALLENGE12345&hub.verify_token=${VERIFY_TOKEN}`,
    );
    expect(valid.status).toBe(200);
    expect(valid.text).toBe('CHALLENGE12345');
    expect(valid.headers['content-type']).toContain('text/plain');

    const wrongToken = await request(app).get(
      `${basePath}?hub.mode=subscribe&hub.challenge=CHALLENGE12345&hub.verify_token=nope`,
    );
    expect(wrongToken.status).toBe(403);

    const missingChallenge = await request(app).get(
      `${basePath}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`,
    );
    expect(missingChallenge.status).toBe(400);

    const unknownOrg = await request(app).get(
      `/api/webhooks/whatsapp/999999?hub.mode=subscribe&hub.challenge=CHALLENGE1&hub.verify_token=${VERIFY_TOKEN}`,
    );
    expect(unknownOrg.status).toBe(404);

    const emptyPayload = JSON.stringify({ entry: [] });
    const good = await postWebhook(emptyPayload);
    expect(good.status).toBe(200);
    expect(good.body.status).toBe('ok');

    const badSignature = await postWebhook(emptyPayload, {
      signature: 'sha256=deadbeefdeadbeef',
    });
    expect(badSignature.status).toBe(401);

    const wrongSecret = await postWebhook(emptyPayload, {
      signature: signBody(emptyPayload, 'some-other-secret'),
    });
    expect(wrongSecret.status).toBe(401);

    const missingHeader = await postWebhook(emptyPayload, { signature: null });
    expect(missingHeader.status).toBe(401);

    const unknownOrgPost = request(server)
      .post('/api/webhooks/whatsapp/999999')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signBody(emptyPayload, APP_SECRET))
      .send(emptyPayload);
    const unknownOrgRes = await unknownOrgPost;
    expect(unknownOrgRes.status).toBe(404);

    const malformed = JSON.stringify({ nonsense: true });
    const malformedRes = await postWebhook(malformed);
    expect(malformedRes.status).toBe(400);

    await setWhatsAppConfig({ appSecret: '' });
    try {
      const emptySecret = await postWebhook(emptyPayload);
      expect(emptySecret.status).toBe(401);
    } finally {
      await setWhatsAppConfig({ appSecret: APP_SECRET });
    }

    await setWhatsAppConfig({ enabled: false });
    try {
      const disabled = await postWebhook(emptyPayload);
      expect(disabled.status).toBe(403);
    } finally {
      await setWhatsAppConfig({ enabled: true });
    }

    expect(await messageByKey('whatsapp:wamid.does.not.exist')).toBeNull();
  });

  it('ignores duplicate inbound webhooks without reprocessing', async () => {
    const phone = '15551230503';
    const raw = JSON.stringify(inboundPayload('wamid.m13.inbound.0002', phone, 'Hello again'));

    const first = await postWebhook(raw);
    expect(first.status).toBe(200);
    expect(first.body.inbound.created).toBe(1);
    expect(first.body.inbound.duplicate).toBe(0);

    const second = await postWebhook(raw);
    expect(second.status).toBe(200);
    expect(second.body.inbound.created).toBe(0);
    expect(second.body.inbound.duplicate).toBe(1);

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM communication_messages WHERE idempotency_key = ?',
      ['whatsapp:wamid.m13.inbound.0002'],
    );
    expect(rows[0]?.total).toBe(1);
  });

  it('suppresses outbound WhatsApp automation for opted-out patients', async () => {
    await setMissedCallConfig({ enabled: true, channel: 'WHATSAPP' });
    try {
      const optOutPhone = '15551230504';
      const created = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ownerCookie)
        .send({ firstName: 'Otta', lastName: 'M13', phone: optOutPhone });
      expect(created.status).toBe(201);
      const patientId = created.body.patient.id as number;
      const optedOut = await request(app)
        .patch(`/api/organizations/${orgId}/patients/${patientId}`)
        .set('Cookie', ownerCookie)
        .send({ smsOptOut: true });
      expect(optedOut.status).toBe(200);
      expect(optedOut.body.patient.smsOptOut).toBe(true);

      const suppressed = await telephonyMissedCall('MC-m13-optout', optOutPhone);
      expect(suppressed.status).toBe(200);
      expect(suppressed.body.disposition).toBe('consent_suppressed');
      expect(suppressed.body.messageId).toBeNull();
      const [suppressedRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM communication_messages WHERE recipient = ?',
        [optOutPhone],
      );
      expect(suppressedRows[0]?.total).toBe(0);

      const activePhone = '15551230505';
      const active = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ownerCookie)
        .send({ firstName: 'Alma', lastName: 'M13', phone: activePhone });
      expect(active.status).toBe(201);

      const sent = await telephonyMissedCall('MC-m13-active', activePhone);
      expect(sent.status).toBe(200);
      expect(sent.body.disposition).toBe('patient_contacted');
      const message = await messageByKey(`missedcall:mock:MC-m13-active`);
      expect(message).not.toBeNull();
      expect(message?.channel).toBe('WHATSAPP');
      expect(message?.status).toBe('SENT');
      expect(message?.message_type).toBe('missed_call_response');
    } finally {
      await setMissedCallConfig({ enabled: true, channel: 'SMS' });
    }
  });

  async function telephonyMissedCall(
    eventId: string,
    fromPhone: string,
  ): Promise<request.Response> {
    const body = {
      eventId,
      status: 'missed',
      from: `+${fromPhone}`,
      to: '+15550000009',
    };
    const pathName = `/api/webhooks/telephony/mock/${orgId}`;
    const fullUrl = `http://127.0.0.1:${serverPort}${pathName}`;
    const signature = signParams(fullUrl, flatten(body), TELEPHONY_SECRET);
    return request(server).post(pathName).set('x-mock-signature', signature).send(body);
  }

  it('records provider failure for unconfigured WhatsApp and provider errors', async () => {
    const notConfigured = await sendTemplateMessage(pool, logger, getProvider('whatsapp'), {
      organizationId: orgId,
      channel: 'WHATSAPP',
      to: '15551230506',
      templateName: 'failure_probe',
      templateText: 'Failure probe unconfigured',
      variables: {},
      idempotencyKey: 'm13:fail:notconfigured',
    });
    expect(notConfigured.outcome).toBe('failed');
    const notConfiguredRow = await messageByKey('m13:fail:notconfigured');
    expect(notConfiguredRow?.status).toBe('FAILED');
    expect(notConfiguredRow?.provider_key).toBe('whatsapp');
    expect(notConfiguredRow?.provider_error).toContain('whatsapp_not_configured');

    registerProvider(new MockProvider({ failOn: ['15551230507'] }));
    try {
      const mockFailure = await sendTemplateMessage(pool, logger, getProvider('mock'), {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: '15551230507',
        templateName: 'failure_probe',
        templateText: 'Failure probe mock outage',
        variables: {},
        idempotencyKey: 'm13:fail:mock',
      });
      expect(mockFailure.outcome).toBe('failed');
      const mockRow = await messageByKey('m13:fail:mock');
      expect(mockRow?.channel).toBe('WHATSAPP');
      expect(mockRow?.status).toBe('FAILED');
      expect(mockRow?.provider_error).toContain('mock_recipient_failure');
    } finally {
      registerProvider(new MockProvider());
    }

    const stubFetch = async (): Promise<unknown> => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'service unavailable',
    });
    vi.stubGlobal('fetch', stubFetch as unknown as typeof fetch);
    try {
      const provider = new WhatsAppProvider(async () => ({
        accessToken: 'stub-token',
        phoneNumberId: '424242',
        apiVersion: 'v26.0',
      }));
      const apiFailure = await sendTemplateMessage(pool, logger, provider, {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: '15551230508',
        templateName: 'failure_probe',
        templateText: 'Failure probe api error',
        variables: {},
        idempotencyKey: 'm13:fail:api',
      });
      expect(apiFailure.outcome).toBe('failed');
      const apiRow = await messageByKey('m13:fail:api');
      expect(apiRow?.status).toBe('FAILED');
      expect(apiRow?.provider_error).toContain('whatsapp_api_error');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns WhatsApp conversation state with role authorization', async () => {
    const inboundPhone = '15551230502';
    const statePath = `/api/organizations/${orgId}/conversation-state`;

    const unauth = await request(app).get(`${statePath}?phone=${inboundPhone}`);
    expect(unauth.status).toBe(401);

    const owner = await request(app)
      .get(`${statePath}?phone=${inboundPhone}`)
      .set('Cookie', ownerCookie);
    expect(owner.status).toBe(200);
    expect(owner.body.phone).toBe(inboundPhone);
    expect(owner.body.windowOpen).toBe(true);
    expect(owner.body.lastInboundAt).not.toBeNull();
    const lastAt = new Date(owner.body.lastInboundAt as string).getTime();
    const expiresAt = new Date(owner.body.windowExpiresAt as string).getTime();
    expect(expiresAt - lastAt).toBe(24 * 3_600_000);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const receptionist = await request(app)
      .get(`${statePath}?phone=${inboundPhone}`)
      .set('Cookie', recCookie);
    expect(receptionist.status).toBe(200);
    expect(receptionist.body.windowOpen).toBe(true);

    const administrator = await request(app)
      .get(`${statePath}?phone=${inboundPhone}`)
      .set('Cookie', adminCookie);
    expect(administrator.status).toBe(200);
    expect(administrator.body.windowOpen).toBe(true);

    const foreignMember = await request(app)
      .get(`${statePath}?phone=${inboundPhone}`)
      .set('Cookie', ownerBCookie);
    expect(foreignMember.status).toBe(404);

    const unknownOrg = await request(app)
      .get(`/api/organizations/999999/conversation-state?phone=${inboundPhone}`)
      .set('Cookie', ownerCookie);
    expect(unknownOrg.status).toBe(404);

    const badPhone = await request(app)
      .get(`${statePath}?phone=not-a-phone`)
      .set('Cookie', ownerCookie);
    expect(badPhone.status).toBe(400);

    const noHistory = await request(app)
      .get(`${statePath}?phone=15551230599`)
      .set('Cookie', ownerCookie);
    expect(noHistory.status).toBe(200);
    expect(noHistory.body.lastInboundAt).toBeNull();
    expect(noHistory.body.windowExpiresAt).toBeNull();
    expect(noHistory.body.windowOpen).toBe(false);

    const backdatedPhone = '15551230598';
    await handleInboundMessage(pool, logger, {
      organizationId: orgId,
      channel: 'WHATSAPP',
      from: backdatedPhone,
      body: 'Old reply',
      idempotencyKey: 'whatsapp:wamid.m13.inbound.backdated',
    });
    await setCreatedAt('whatsapp:wamid.m13.inbound.backdated', 25);
    const backdated = await request(app)
      .get(`${statePath}?phone=${backdatedPhone}`)
      .set('Cookie', ownerCookie);
    expect(backdated.status).toBe(200);
    expect(backdated.body.windowOpen).toBe(false);
    expect(new Date(backdated.body.windowExpiresAt as string).getTime()).toBeLessThan(Date.now());
  });
});
