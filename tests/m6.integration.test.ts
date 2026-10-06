import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { MockProvider } from '../src/communications/mockProvider';
import { registerProvider } from '../src/communications/registry';
import { ACK_CONFIG_META_KEY, DEFAULT_ACK_CONFIG } from '../src/automation/config';
import {
  retryLeadAcknowledgement,
  triggerLeadCreated,
} from '../src/automation/leadCreated';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';
import {
  applyProviderStatus,
  getMessage,
  handleInboundMessage,
} from '../src/services/messages';

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

describe.skipIf(testHost === undefined || testHost === '')(
  'M6 acceptance: instant lead follow-up',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgAId: number;
    let orgBId: number;
    const keyA = generateSiteKey();

    const ownerEmail = 'owner.m6@apextest.local';
    const ownerPassword = 'OwnerM6Passw0rd!26x';
    let ownerCookie: string;

    const PHONE_VERA = '15550202001';
    const PHONE_FAIL = '999999999';
    const PHONE_DISABLED = '15550202002';
    const PHONE_STAFF_WEBSITE = '15550202003';

    let veraLeadId = 0;
    let veraAckId = 0;
    let failLeadId = 0;

    async function insertOrg(name: string, siteKey: string | null): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
        [name, siteKey],
      );
      return row.insertId;
    }

    async function ackRows(leadId: number): Promise<mysql.RowDataPacket[]> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT * FROM communication_messages WHERE lead_id = ?',
        [leadId],
      );
      return rows;
    }

    function postLead(siteKey: string, body: unknown): request.Test {
      return request(app).post('/api/public/leads').set('X-Site-Key', siteKey).send(body as object);
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
      await pool.query('DELETE FROM appointments');
      await pool.query('DELETE FROM communication_messages');
      await pool.query('DELETE FROM lead_activities');
      await pool.query('DELETE FROM leads');
      await pool.query('DELETE FROM patients');
      await pool.query('DELETE FROM users');
      await pool.query('DELETE FROM organizations');
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [ACK_CONFIG_META_KEY]);

      orgAId = await insertOrg('M6 Clinic A', keyA);
      orgBId = await insertOrg('M6 Clinic B', generateSiteKey());

      const hash = await hashPassword(ownerPassword);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [orgAId, ownerEmail, hash, 'owner'],
      );

      logger = captureLogger();
      app = createApp({ db: pool, logger });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      ownerCookie = cookie(login);
      expect(login.status).toBe(200);
    }, 30_000);

    afterAll(async () => {
      registerProvider(new MockProvider());
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('sends the acknowledgement with the correct template, recipient and clinic', async () => {
      const res = await postLead(keyA, {
        firstName: 'Vera',
        lastName: 'Website',
        phone: PHONE_VERA,
      });
      expect(res.status).toBe(201);
      veraLeadId = res.body.leadId;

      const rows = await ackRows(veraLeadId);
      expect(rows).toHaveLength(1);
      const ack = rows[0] as mysql.RowDataPacket;
      expect(ack.organization_id).toBe(orgAId);
      expect(ack.recipient).toBe(PHONE_VERA);
      expect(ack.status).toBe('SENT');
      expect(ack.direction).toBe('OUTBOUND');
      expect(ack.message_type).toBe('lead_acknowledgement');
      expect(ack.template).toBe('lead_acknowledgement');
      expect(ack.provider_key).toBe('mock');
      expect(String(ack.provider_message_id)).toMatch(/^mock-/);
      expect(ack.sent_at).not.toBeNull();
      expect(ack.body).toContain('Vera');
      expect(ack.body).toContain('M6 Clinic A');
      expect(ack.body).not.toContain('{{');
      veraAckId = ack.id;

      const triggers = logger.entries.filter(
        (e) => e.message === 'automation trigger: lead_created',
      );
      expect(triggers[triggers.length - 1]?.fields).toMatchObject({
        organizationId: orgAId,
        leadId: veraLeadId,
        source: 'WEBSITE',
      });
      const results = logger.entries.filter((e) => e.message === 'lead acknowledgement result');
      expect(results[results.length - 1]?.fields).toMatchObject({
        leadId: veraLeadId,
        action: 'ack_sent',
      });
      expect(JSON.stringify(results)).not.toContain(PHONE_VERA);
    });

    it('prevents duplicate acknowledgement records (MVP TEST 2)', async () => {
      const second = await triggerLeadCreated(pool, logger, {
        organizationId: orgAId,
        leadId: veraLeadId,
      });
      expect(second.action).toBe('ack_duplicate');

      const dup = await postLead(keyA, {
        firstName: 'Vera',
        lastName: 'Website',
        phone: PHONE_VERA,
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('duplicate_lead');

      expect(await ackRows(veraLeadId)).toHaveLength(1);
      const [leadCount] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS c FROM leads WHERE organization_id = ? AND phone = ?',
        [orgAId, PHONE_VERA],
      );
      expect(Number(leadCount[0]?.c)).toBe(1);
    });

    it('records a provider failure without failing lead creation', async () => {
      const res = await postLead(keyA, {
        firstName: 'Fail',
        lastName: 'Recipient',
        phone: PHONE_FAIL,
      });
      expect(res.status).toBe(201);
      failLeadId = res.body.leadId;

      const rows = await ackRows(failLeadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('FAILED');
      expect(String(rows[0]?.provider_error)).toContain('mock_recipient_failure');
      expect(rows[0]?.attempts).toBe(1);

      const results = logger.entries.filter((e) => e.message === 'lead acknowledgement result');
      expect(results[results.length - 1]?.fields).toMatchObject({
        leadId: failLeadId,
        action: 'ack_failed',
      });
    });

    it('retries a failed acknowledgement until the provider accepts it', async () => {
      const stillFailing = await retryLeadAcknowledgement(pool, logger, {
        organizationId: orgAId,
        leadId: failLeadId,
      });
      expect(stillFailing.action).toBe('ack_failed');
      let rows = await ackRows(failLeadId);
      expect(rows[0]?.status).toBe('FAILED');
      expect(rows[0]?.attempts).toBe(2);

      registerProvider(new MockProvider({ failOn: [] }));
      const recovered = await retryLeadAcknowledgement(pool, logger, {
        organizationId: orgAId,
        leadId: failLeadId,
      });
      expect(recovered.action).toBe('ack_sent');
      rows = await ackRows(failLeadId);
      expect(rows[0]?.status).toBe('SENT');
      expect(rows[0]?.attempts).toBe(3);
      expect(rows[0]?.provider_error).toBeNull();
      expect(String(rows[0]?.provider_message_id)).toMatch(/^mock-/);
    });

    it('retries an interrupted (PENDING) acknowledgement', async () => {
      const [result] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO communication_messages
           (organization_id, channel, recipient, body, idempotency_key, direction, message_type,
            template, lead_id, status)
         VALUES (?, 'SMS', ?, 'Interrupted ack', ?, 'OUTBOUND', 'lead_acknowledgement',
                 'lead_acknowledgement', ?, 'PENDING')`,
        [orgAId, '15550202007', 'ack:lead:999001', veraLeadId],
      );
      const pendingId = result.insertId;

      const retried = await retryLeadAcknowledgement(pool, logger, {
        organizationId: orgAId,
        leadId: veraLeadId,
      });
      expect(retried.action).toBe('ack_sent');
      expect(retried.messageId).toBe(pendingId);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status, attempts FROM communication_messages WHERE id = ?',
        [pendingId],
      );
      expect(rows[0]?.status).toBe('SENT');
      expect(rows[0]?.attempts).toBe(1);

      await pool.query('DELETE FROM communication_messages WHERE id = ?', [pendingId]);
    });

    it('respects the enabled automation configuration', async () => {
      const disabled = JSON.stringify({ ...DEFAULT_ACK_CONFIG, enabled: false });
      await pool.query('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [
        ACK_CONFIG_META_KEY,
        disabled,
      ]);

      const res = await postLead(keyA, {
        firstName: 'No',
        lastName: 'Ack',
        phone: PHONE_DISABLED,
      });
      expect(res.status).toBe(201);
      expect(await ackRows(res.body.leadId)).toHaveLength(0);

      const skipped = logger.entries.filter((e) => e.message === 'lead automation skipped');
      expect(skipped[skipped.length - 1]?.fields).toMatchObject({
        leadId: res.body.leadId,
        reason: 'disabled',
      });

      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [ACK_CONFIG_META_KEY]);
    });

    it('falls back to defaults on corrupt configuration', async () => {
      await pool.query('INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)', [
        ACK_CONFIG_META_KEY,
        'not-json{',
      ]);
      const res = await postLead(keyA, {
        firstName: 'Recover',
        lastName: 'Config',
        phone: '15550202004',
      });
      expect(res.status).toBe(201);
      const rows = await ackRows(res.body.leadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('SENT');
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [ACK_CONFIG_META_KEY]);
    });

    it('acknowledges staff-created website and manual leads but not missed-call leads (source filter)', async () => {
      const manual = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: 'Walk',
          lastName: 'In',
          phone: '15550202005',
          source: 'MANUAL',
        });
      expect(manual.status).toBe(201);
      const manualLeadId = manual.body.lead.id;
      const manualRows = await ackRows(manualLeadId);
      expect(manualRows).toHaveLength(1);
      expect(manualRows[0]?.status).toBe('SENT');
      expect(manualRows[0]?.body).toContain('Walk');

      const missed = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: 'Missed',
          lastName: 'Caller',
          phone: '15550202006',
          source: 'MISSED_CALL',
        });
      expect(missed.status).toBe(201);
      const missedLeadId = missed.body.lead.id;
      expect(await ackRows(missedLeadId)).toHaveLength(0);
      const skipped = logger.entries.filter((e) => e.message === 'lead automation skipped');
      expect(skipped[skipped.length - 1]?.fields).toMatchObject({
        leadId: missedLeadId,
        reason: 'source_not_configured',
      });

      const staffWebsite = await request(app)
        .post(`/api/organizations/${orgAId}/leads`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: 'Staff',
          lastName: 'Entered',
          phone: PHONE_STAFF_WEBSITE,
          source: 'WEBSITE',
        });
      expect(staffWebsite.status).toBe(201);
      const staffLeadId = staffWebsite.body.lead.id;
      const rows = await ackRows(staffLeadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('SENT');
      expect(rows[0]?.organization_id).toBe(orgAId);
      expect(rows[0]?.body).toContain('Staff');
      expect(rows[0]?.body).toContain('M6 Clinic A');
    });

    it('handles the patient response and links it to the lead', async () => {
      const inbound = await handleInboundMessage(pool, logger, {
        organizationId: orgAId,
        channel: 'SMS',
        from: `+${PHONE_VERA}`,
        body: 'Evenings please',
        idempotencyKey: 'inb:m6:1',
      });
      expect(inbound.created).toBe(true);
      expect(inbound.message).toMatchObject({
        direction: 'INBOUND',
        status: 'RECEIVED',
        messageType: 'patient_reply',
        leadId: veraLeadId,
        recipient: PHONE_VERA,
        organizationId: orgAId,
      });

      const repeat = await handleInboundMessage(pool, logger, {
        organizationId: orgAId,
        channel: 'SMS',
        from: `+${PHONE_VERA}`,
        body: 'Evenings please',
        idempotencyKey: 'inb:m6:1',
      });
      expect(repeat.created).toBe(false);

      const [inboundCount] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS c FROM communication_messages WHERE idempotency_key = 'inb:m6:1'",
      );
      expect(Number(inboundCount[0]?.c)).toBe(1);

      const orphan = await handleInboundMessage(pool, logger, {
        organizationId: orgAId,
        channel: 'SMS',
        from: '15550999999',
        body: 'Wrong number?',
        idempotencyKey: 'inb:m6:2',
      });
      expect(orphan.created).toBe(true);
      expect(orphan.message.leadId).toBeNull();
    });

    it('tracks delivery status on the acknowledgement', async () => {
      const updated = await applyProviderStatus(pool, logger, {
        organizationId: orgAId,
        messageId: veraAckId,
        status: 'DELIVERED',
      });
      expect(updated.status).toBe('DELIVERED');
      expect(updated.deliveredAt).not.toBeNull();

      const fetched = await getMessage(pool, orgAId, veraAckId);
      expect(fetched?.status).toBe('DELIVERED');
      expect(fetched?.direction).toBe('OUTBOUND');
    });

    it('keeps clinic B isolated (its own lead gets its own acknowledgement)', async () => {
      const [orgBRow] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT site_key FROM organizations WHERE id = ?',
        [orgBId],
      );
      const keyB = String(orgBRow[0]?.site_key);
      const res = await request(app)
        .post('/api/public/leads')
        .set('X-Site-Key', keyB)
        .send({ firstName: 'Cross', lastName: 'Tenant', phone: '15550202006' });
      expect(res.status).toBe(201);
      const rows = await ackRows(res.body.leadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.organization_id).toBe(orgBId);
      expect(rows[0]?.body).toContain('M6 Clinic B');
      expect(rows[0]?.body).not.toContain('M6 Clinic A');
    });
  },
);
