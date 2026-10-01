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

describe.skipIf(testHost === undefined || testHost === '')('F2 operational APIs', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let orgId: number;
  let orgBId: number;
  let patientAId: number;
  let patientBId: number;
  let leadWithMsgId: number;
  let leadNoMsgId: number;
  let recallDueId: number;
  let recallContactedId: number;
  let recallBookedId: number;
  let recallNoMessagesId: number;
  let inboundMsgId: number;

  const ownerEmail = 'owner.f2@apextest.local';
  const ownerPassword = 'OwnerF2Passw0rd!26x';
  const recEmail = 'rec.f2@apextest.local';
  const recPassword = 'RecF2Passw0rd!26x';
  const ownerBEmail = 'owner.f2b@apextest.local';
  const ownerBPassword = 'OwnerF2BPassw0rd!26x';

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

    orgId = await insertOrg('F2 Clinic');
    orgBId = await insertOrg('F2 Clinic B');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');

    const [patientA] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgId, 'Sara', 'Halim', '+15550300001'],
    );
    patientAId = patientA.insertId;
    const [patientB] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgId, 'Omar', 'Nasser', '+15550300002'],
    );
    patientBId = patientB.insertId;

    const [leadWithMsg] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO leads (organization_id, first_name, last_name, phone, source, status)' +
        " VALUES (?, ?, ?, ?, 'MANUAL', 'NEW')",
      [orgId, 'Sara', 'Halim', '+15550300001'],
    );
    leadWithMsgId = leadWithMsg.insertId;
    const [leadNoMsg] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO leads (organization_id, first_name, last_name, phone, source, status)' +
        " VALUES (?, ?, ?, ?, 'WEBSITE', 'NEW')",
      [orgId, 'No', 'Messages', '+15550300009'],
    );
    leadNoMsgId = leadNoMsg.insertId;

    async function insertMessage(
      direction: string,
      recipient: string,
      body: string,
      leadId: number | null,
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO communication_messages (organization_id, channel, direction, recipient,' +
          ' body, status, idempotency_key, lead_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          orgId,
          'WHATSAPP',
          direction,
          recipient,
          body,
          direction === 'INBOUND' ? 'RECEIVED' : 'SENT',
          `f2-${direction}-${recipient}-${Math.random().toString(36).slice(2)}`,
          leadId,
        ],
      );
      return row.insertId;
    }

    inboundMsgId = await insertMessage('INBOUND', '+15550300001', 'Can I move my visit?', leadWithMsgId);
    await insertMessage('OUTBOUND', '+15550300001', 'Sure, what day works?', leadWithMsgId);
    await insertMessage('INBOUND', '+15550300002', 'unrelated inbound', null);
    await insertMessage('OUTBOUND', '+15550300009', 'no lead on this one', null);

    async function insertRecall(
      patientId: number,
      dueDate: string,
      status: string,
    ): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO recalls (organization_id, patient_id, recall_type, due_date, status, opened_at)' +
          " VALUES (?, ?, 'hygiene', ?, ?, DATE_SUB(NOW(), INTERVAL 30 DAY))",
        [orgId, patientId, dueDate, status],
      );
      return row.insertId;
    }

    const due = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const overdue = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    recallDueId = await insertRecall(patientAId, due, 'DUE');
    recallContactedId = await insertRecall(patientBId, overdue, 'CONTACTED');
    recallBookedId = await insertRecall(patientAId, overdue, 'BOOKED');
    recallNoMessagesId = await insertRecall(patientBId, due, 'DUE');

    await pool.query(
      'INSERT INTO recall_messages (recall_id, organization_id, phase, status, scheduled_at)' +
        " VALUES (?, ?, 'INITIAL', 'PENDING', DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [recallDueId, orgId],
    );

    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger });

    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
  }, 60_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.end();
    }
  });

  describe('GET /api/organizations/:orgId/recalls', () => {
    it('requires authentication', async () => {
      const res = await request(app).get(`/api/organizations/${orgId}/recalls`);
      expect(res.status).toBe(401);
    });

    it('lists recalls ordered by due date with patient details', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as {
        recalls: Array<Record<string, unknown>>;
        total: number;
        limit: number;
        offset: number;
      };
      expect(body.total).toBe(4);
      expect(body.limit).toBeGreaterThanOrEqual(body.total);
      const statuses = body.recalls.map((r) => r.status);
      expect(statuses).toContain('DUE');
      expect(statuses).toContain('CONTACTED');
      expect(statuses).toContain('BOOKED');
      const dates = body.recalls.map((r) => String(r.dueDate));
      expect([...dates].sort()).toEqual(dates);
      const first = body.recalls[0] as { patient: { firstName: string; phone: string } };
      expect(first.patient.firstName).toBe('Omar');
      expect(first.patient.phone).toBe('+15550300002');
    });

    it('filters by status', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls?status=DUE`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as { recalls: Array<{ status: string }>; total: number };
      expect(body.total).toBe(2);
      expect(body.recalls.every((r) => r.status === 'DUE')).toBe(true);
    });

    it('filters by patientId', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls?patientId=${patientBId}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as { total: number; recalls: Array<{ patientId: number }> };
      expect(body.total).toBe(2);
      expect(body.recalls.every((r) => r.patientId === patientBId)).toBe(true);
    });

    it('searches by patient name and phone', async () => {
      const byName = await request(app)
        .get(`/api/organizations/${orgId}/recalls?q=Sara`)
        .set('Cookie', ownerCookie);
      expect(byName.status).toBe(200);
      expect((byName.body as { total: number }).total).toBe(2);

      const byPhone = await request(app)
        .get(`/api/organizations/${orgId}/recalls?q=%2B15550300002`)
        .set('Cookie', ownerCookie);
      expect(byPhone.status).toBe(200);
      expect((byPhone.body as { total: number }).total).toBe(2);
    });

    it('rejects an invalid status filter', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls?status=NOPE`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(400);
    });

    it('lets a receptionist view recalls', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls`)
        .set('Cookie', recCookie);
      expect(res.status).toBe(200);
      expect((res.body as { total: number }).total).toBe(4);
    });

    it("returns 404 for another clinic's recalls", async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/recalls`)
        .set('Cookie', ownerBCookie);
      expect(res.status).toBe(404);
    });

    it('lists only its own clinic recalls', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgBId}/recalls`)
        .set('Cookie', ownerBCookie);
      expect(res.status).toBe(200);
      expect((res.body as { total: number }).total).toBe(0);
    });
  });

  describe('POST /api/organizations/:orgId/recalls/:recallId/close (existing endpoint)', () => {
    it('requires authentication', async () => {
      const res = await request(app).post(`/api/organizations/${orgId}/recalls/${recallDueId}/close`);
      expect(res.status).toBe(401);
    });

    it('denies a receptionist (close is management-only)', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/${recallDueId}/close`)
        .set('Cookie', recCookie)
        .send({ reason: 'no_longer_needed' });
      expect(res.status).toBe(403);
    });

    it('closes a DUE recall, records the reason and cancels pending messages', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/${recallDueId}/close`)
        .set('Cookie', ownerCookie)
        .send({ reason: 'no_longer_needed' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        recall: { id: recallDueId, status: 'CLOSED', closeReason: 'no_longer_needed' },
      });

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status, close_reason, closed_at FROM recalls WHERE id = ?',
        [recallDueId],
      );
      expect(rows[0]?.status).toBe('CLOSED');
      expect(rows[0]?.close_reason).toBe('no_longer_needed');
      expect(rows[0]?.closed_at).not.toBeNull();

      const [messages] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status, suppression_reason FROM recall_messages WHERE recall_id = ?',
        [recallDueId],
      );
      expect(messages.length).toBe(1);
      expect(messages[0]?.status).toBe('CANCELLED');
      expect(messages[0]?.suppression_reason).toBe('no_longer_needed');
    });

    it('returns 404 when the recall is already closed', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/${recallDueId}/close`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(404);
    });

    it('returns 404 when the recall status is BOOKED', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/${recallBookedId}/close`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(404);
    });

    it('closes a CONTACTED recall with the default staff_closed reason', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/${recallContactedId}/close`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        recall: { id: recallContactedId, status: 'CLOSED', closeReason: 'staff_closed' },
      });
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT close_reason FROM recalls WHERE id = ?',
        [recallContactedId],
      );
      expect(rows[0]?.close_reason).toBe('staff_closed');
    });

    it('returns 404 for a missing recall', async () => {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/recalls/999999/close`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(404);
    });

    it("returns 404 for another clinic's recall", async () => {
      const ownView = await request(app)
        .get(`/api/organizations/${orgId}/recalls?status=DUE`)
        .set('Cookie', ownerCookie);
      expect(ownView.status).toBe(200);
      const remaining = (ownView.body as { total: number }).total;
      expect(remaining).toBe(1);

      const closeOther = await request(app)
        .post(`/api/organizations/${orgBId}/recalls/${recallNoMessagesId}/close`)
        .set('Cookie', ownerBCookie)
        .send({});
      expect(closeOther.status).toBe(404);
    });
  });

  describe('GET /api/organizations/:orgId/communications', () => {
    it('requires authentication', async () => {
      const res = await request(app).get(`/api/organizations/${orgId}/communications`);
      expect(res.status).toBe(401);
    });

    it('lets a receptionist list communications', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications`)
        .set('Cookie', recCookie);
      expect(res.status).toBe(200);
      const body = res.body as { messages: Array<{ id: number }>; total: number };
      expect(body.total).toBe(4);
      expect(body.messages.map((m) => m.id)).toContain(inboundMsgId);
    });

    it('keeps the observability communication log admin-only (receptionist 403)', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/observability/communication-logs`)
        .set('Cookie', recCookie);
      expect(res.status).toBe(403);
    });

    it('filters by direction', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications?direction=INBOUND`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as { total: number; messages: Array<{ direction: string }> };
      expect(body.total).toBe(2);
      expect(body.messages.every((m) => m.direction === 'INBOUND')).toBe(true);
    });

    it('filters by leadId', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications?leadId=${leadWithMsgId}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as { total: number; messages: Array<{ leadId: number | null }> };
      expect(body.total).toBe(2);
      expect(body.messages.every((m) => m.leadId === leadWithMsgId)).toBe(true);
    });

    it('filters by recipient', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications?recipient=%2B15550300002`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect((res.body as { total: number }).total).toBe(1);
    });

    it('rejects an invalid leadId filter', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications?leadId=abc`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(400);
    });

    it("returns 404 for another clinic's messages", async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/communications`)
        .set('Cookie', ownerBCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/organizations/:orgId/observability/automation-logs subjectId filter', () => {
    it('filters automation jobs by subject id', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/observability/automation-logs?kind=recall&subjectId=${recallDueId}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const body = res.body as { logs: Array<{ subject_id: number; kind: string }>; total: number };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.logs.every((log) => log.subject_id === recallDueId)).toBe(true);
      expect(body.logs.every((log) => log.kind === 'recall')).toBe(true);
    });

    it('returns an empty list for a subject without jobs', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/observability/automation-logs?kind=recall&subjectId=999999`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect((res.body as { logs: unknown[] }).logs).toEqual([]);
    });

    it('rejects a non-integer subjectId', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/observability/automation-logs?subjectId=abc`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(400);
    });

    it('remains admin-only for receptionists', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/observability/automation-logs?subjectId=${recallDueId}`)
        .set('Cookie', recCookie);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/organizations/:orgId/leads/:leadId communication history', () => {
    it('returns communication history for a lead with messages', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/leads/${leadWithMsgId}`)
        .set('Cookie', recCookie);
      expect(res.status).toBe(200);
      const body = res.body as {
        communicationHistory: Array<{ id: number; direction: string; body: string }>;
      };
      expect(body.communicationHistory.length).toBe(2);
      expect(body.communicationHistory.map((m) => m.id)).toContain(inboundMsgId);
      expect(body.communicationHistory[0]?.body).toBeTruthy();
    });

    it('returns an empty history for a lead without messages', async () => {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/leads/${leadNoMsgId}`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      expect((res.body as { communicationHistory: unknown[] }).communicationHistory).toEqual([]);
    });
  });
});
