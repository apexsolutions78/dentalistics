import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import type { DbConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';
import type { WhatsAppDeliveryProvider } from '../src/communications/whatsappDelivery';
import { deliverWhatsAppReminder } from '../src/services/whatsappManual';

const testHost = process.env.TEST_DB_HOST;
const ORG_A = 'Chart Clinic A';
const ORG_B = 'Chart Clinic B';
const OWNER_A = 'chart-owner-a@clinical.test';
const DESK_A = 'chart-desk-a@clinical.test';
const OWNER_B = 'chart-owner-b@clinical.test';
const PASSWORD = 'ChartOwnerPassw0rd!26';

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

function dateDaysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(testHost === undefined || testHost === '')('dental chart and manual WhatsApp', () => {
  let pool: mysql.Pool | undefined;
  let app: Express;
  let orgA = 0;
  let orgB = 0;
  let ownerCookie = '';
  let deskCookie = '';
  let otherCookie = '';
  let ownerId = 0;
  let patientId = 0;
  let appointmentId = 0;
  let recallId = 0;
  let visitDate = '';

  const logger = createLogger({ level: 'error', write: () => undefined });

  function db(): mysql.Pool {
    if (pool === undefined) {
      throw new Error('database pool was not created');
    }
    return pool;
  }

  async function cleanup(): Promise<void> {
    if (pool === undefined) return;
    const [orgs] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id FROM organizations WHERE name IN (?, ?)',
      [ORG_A, ORG_B],
    );
    const ids = orgs.map((row) => Number(row.id));
    if (ids.length === 0) return;
    const marks = ids.map(() => '?').join(', ');
    await pool.query(`DELETE FROM communication_messages WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM recalls WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM appointments WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM patients WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM audit_logs WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM users WHERE organization_id IN (${marks})`, ids);
    await pool.query(`DELETE FROM organizations WHERE id IN (${marks})`, ids);
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
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    await cleanup();

    const [orgRow] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, timezone) VALUES (?, ?)',
      [ORG_A, 'UTC'],
    );
    orgA = orgRow.insertId;
    const [orgRowB] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name) VALUES (?)',
      [ORG_B],
    );
    orgB = orgRowB.insertId;
    const hash = await hashPassword(PASSWORD);
    const [owner] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgA, OWNER_A, hash, 'owner'],
    );
    ownerId = owner.insertId;
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgA, DESK_A, hash, 'receptionist'],
    );
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgB, OWNER_B, hash, 'owner'],
    );

    app = createApp({ db: pool, logger });
    const login = async (email: string): Promise<string> => {
      const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(200);
      return cookie(res);
    };
    ownerCookie = await login(OWNER_A);
    deskCookie = await login(DESK_A);
    otherCookie = await login(OWNER_B);

    const patient = await request(app)
      .post(`/api/organizations/${orgA}/patients`)
      .set('Cookie', ownerCookie)
      .send({ firstName: 'Layla', lastName: 'Rahman', phone: '+971501110001' });
    expect(patient.status).toBe(201);
    patientId = patient.body.patient.id as number;

    visitDate = dateDaysAhead(14);
    const appointment = await request(app)
      .post(`/api/organizations/${orgA}/appointments`)
      .set('Cookie', ownerCookie)
      .send({ patientId, date: visitDate, time: '10:00', service: 'Cleaning' });
    expect(appointment.status).toBe(201);
    appointmentId = appointment.body.appointment.id as number;

    const [recall] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO recalls (organization_id, patient_id, recall_type, due_date, status, opened_at)
       VALUES (?, ?, 'hygiene', ?, 'DUE', UTC_TIMESTAMP())`,
      [orgA, patientId, dateDaysAhead(20)],
    );
    recallId = recall.insertId;
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await cleanup();
      await pool.end();
    }
  });

  it('stores FDI teeth, history, a treatment plan, and the numbering setting', async () => {
    const empty = await request(app)
      .get(`/api/organizations/${orgA}/patients/${patientId}/chart`)
      .set('Cookie', deskCookie);
    expect(empty.status).toBe(200);
    expect(empty.body.numbering).toBe('FDI');
    expect(empty.body.teeth).toEqual([]);
    expect(empty.body.conditions.map((item: { code: string }) => item.code)).toContain('extraction_planned');

    const denied = await request(app)
      .put(`/api/organizations/${orgA}/patients/${patientId}/chart/teeth/16`)
      .set('Cookie', deskCookie)
      .send({ conditions: ['caries'], notes: 'desk' });
    expect(denied.status).toBe(403);

    const foreign = await request(app)
      .get(`/api/organizations/${orgA}/patients/${patientId}/chart`)
      .set('Cookie', otherCookie);
    expect(foreign.status).toBe(404);

    const saved = await request(app)
      .put(`/api/organizations/${orgA}/patients/${patientId}/chart/teeth/16`)
      .set('Cookie', ownerCookie)
      .send({ conditions: ['caries', 'caries'], notes: ' Occlusal pit ' });
    expect(saved.status).toBe(200);
    expect(saved.body.unchanged).toBe(false);
    expect(saved.body.tooth.conditions).toEqual(['caries']);
    expect(saved.body.tooth.notes).toBe('Occlusal pit');
    expect(saved.body.tooth.updatedBy.email).toBe(OWNER_A);

    const again = await request(app)
      .put(`/api/organizations/${orgA}/patients/${patientId}/chart/teeth/16`)
      .set('Cookie', ownerCookie)
      .send({ conditions: ['caries'], notes: 'Occlusal pit' });
    expect(again.status).toBe(200);
    expect(again.body.unchanged).toBe(true);

    const badTooth = await request(app)
      .put(`/api/organizations/${orgA}/patients/${patientId}/chart/teeth/99`)
      .set('Cookie', ownerCookie)
      .send({ conditions: [], notes: null });
    expect(badTooth.status).toBe(400);

    const cleared = await request(app)
      .put(`/api/organizations/${orgA}/patients/${patientId}/chart/teeth/16`)
      .set('Cookie', ownerCookie)
      .send({ conditions: ['filled', 'root_canal'], notes: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.tooth.conditions).toEqual(['filled', 'root_canal']);

    const chart = await request(app)
      .get(`/api/organizations/${orgA}/patients/${patientId}/chart`)
      .set('Cookie', ownerCookie);
    expect(chart.body.history).toHaveLength(2);
    expect(chart.body.history[0].author.email).toBe(OWNER_A);
    expect(chart.body.history[0].tooth).toBe('16');

    const plan = await request(app)
      .post(`/api/organizations/${orgA}/patients/${patientId}/treatment-plan`)
      .set('Cookie', ownerCookie)
      .send({ tooth: '16', procedure: 'Composite filling', estimatedFee: '180.5' });
    expect(plan.status).toBe(201);
    expect(plan.body.item.status).toBe('PLANNED');
    expect(plan.body.item.estimatedFee).toBe('180.50');
    const itemId = plan.body.item.id as number;

    const done = await request(app)
      .patch(`/api/organizations/${orgA}/patients/${patientId}/treatment-plan/${itemId}`)
      .set('Cookie', ownerCookie)
      .send({ status: 'DONE' });
    expect(done.status).toBe(200);
    expect(done.body.item.status).toBe('DONE');

    const numbering = await request(app)
      .patch(`/api/organizations/${orgA}/settings/clinic`)
      .set('Cookie', ownerCookie)
      .send({ chartNumbering: 'UNIVERSAL' });
    expect(numbering.status).toBe(200);
    expect(numbering.body.settings.clinic.chartNumbering).toBe('UNIVERSAL');

    const universal = await request(app)
      .get(`/api/organizations/${orgA}/patients/${patientId}/chart`)
      .set('Cookie', ownerCookie);
    expect(universal.body.numbering).toBe('UNIVERSAL');
    expect(universal.body.teeth[0].tooth).toBe('16');

    const removed = await request(app)
      .delete(`/api/organizations/${orgA}/patients/${patientId}/treatment-plan/${itemId}`)
      .set('Cookie', ownerCookie);
    expect(removed.status).toBe(200);

    const [audits] = await db().query<mysql.RowDataPacket[]>(
      `SELECT action FROM audit_logs
       WHERE organization_id = ? AND user_id = ? AND action IN
         ('tooth_chart_updated', 'treatment_plan_created', 'treatment_plan_updated', 'treatment_plan_deleted', 'settings_updated')`,
      [orgA, ownerId],
    );
    const actions = audits.map((row) => row.action);
    expect(actions).toContain('tooth_chart_updated');
    expect(actions).toContain('treatment_plan_created');
    expect(actions).toContain('treatment_plan_updated');
    expect(actions).toContain('treatment_plan_deleted');
    expect(actions).toContain('settings_updated');
  });

  it('opens a manual WhatsApp reminder and refuses an opted-out patient', async () => {
    const sent = await request(app)
      .post(`/api/organizations/${orgA}/appointments/${appointmentId}/whatsapp`)
      .set('Cookie', deskCookie)
      .send({});
    expect(sent.status).toBe(201);
    expect(sent.body.phoneE164).toBe('+971501110001');
    expect(sent.body.template).toBe('appointment_reminder_48h');
    expect(sent.body.body).toContain('Layla');
    expect(sent.body.body).toContain(visitDate);
    expect(sent.body.body).toContain('10:00');
    expect(sent.body.body).not.toContain('{{');
    expect(sent.body.url).toMatch(/^https:\/\/wa\.me\/971501110001\?text=/);
    expect(sent.body.message.channel).toBe('WHATSAPP');
    expect(sent.body.message.status).toBe('SENT');
    expect(sent.body.message.providerKey).toBe('whatsapp_manual');
    expect(sent.body.message.direction).toBe('OUTBOUND');

    const listed = await request(app)
      .get(`/api/organizations/${orgA}/communications?recipient=971501110001&channel=WHATSAPP`)
      .set('Cookie', ownerCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.messages.some((row: { id: number }) => row.id === sent.body.message.id)).toBe(true);

    const recall = await request(app)
      .post(`/api/organizations/${orgA}/recalls/${recallId}/whatsapp`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(recall.status).toBe(201);
    expect(recall.body.template).toBe('recall_message');
    expect(recall.body.body).toContain('Layla');
    expect(recall.body.message.providerKey).toBe('whatsapp_manual');
    expect(recall.body.message.status).toBe('SENT');

    await request(app)
      .patch(`/api/organizations/${orgA}/patients/${patientId}`)
      .set('Cookie', ownerCookie)
      .send({ smsOptOut: true });

    const [beforeRows] = await db().query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM communication_messages WHERE organization_id = ?',
      [orgA],
    );
    const blocked = await request(app)
      .post(`/api/organizations/${orgA}/appointments/${appointmentId}/whatsapp`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('consent_suppressed');
    const [afterRows] = await db().query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM communication_messages WHERE organization_id = ?',
      [orgA],
    );
    expect(Number(afterRows[0]?.n)).toBe(Number(beforeRows[0]?.n));

    const missing = await request(app)
      .post(`/api/organizations/${orgB}/appointments/${appointmentId}/whatsapp`)
      .set('Cookie', otherCookie)
      .send({});
    expect(missing.status).toBe(404);

    await request(app)
      .patch(`/api/organizations/${orgA}/patients/${patientId}`)
      .set('Cookie', ownerCookie)
      .send({ smsOptOut: false });
  });

  it('logs an API-shaped provider without opening wa.me, and records a failed handoff', async () => {
    await request(app)
      .patch(`/api/organizations/${orgA}/patients/${patientId}`)
      .set('Cookie', ownerCookie)
      .send({ smsOptOut: false });

    const apiProvider: WhatsAppDeliveryProvider = {
      key: 'whatsapp_api_example',
      mode: 'api',
      handoff: () =>
        Promise.resolve({
          mode: 'api',
          providerKey: 'whatsapp_api_example',
          url: null,
          providerMessageId: 'wamid.test',
        }),
    };
    const delivered = await deliverWhatsAppReminder(db(), logger, {
      organizationId: orgA,
      actorId: ownerId,
      kind: 'recall',
      subjectId: recallId,
      provider: apiProvider,
    });
    expect(delivered.url).toBeNull();
    const message = delivered.message as { status: string; providerKey: string; providerMessageId: string };
    expect(message.status).toBe('SENT');
    expect(message.providerKey).toBe('whatsapp_api_example');
    expect(message.providerMessageId).toBe('wamid.test');

    const failing: WhatsAppDeliveryProvider = {
      key: 'whatsapp_api_example',
      mode: 'api',
      handoff: () => Promise.reject(new Error('provider down')),
    };
    await expect(
      deliverWhatsAppReminder(db(), logger, {
        organizationId: orgA,
        actorId: ownerId,
        kind: 'appointment',
        subjectId: appointmentId,
        provider: failing,
      }),
    ).rejects.toMatchObject({ code: 'whatsapp_handoff_failed' });
    const [failed] = await db().query<mysql.RowDataPacket[]>(
      `SELECT status, provider_key FROM communication_messages
       WHERE organization_id = ? AND provider_key = 'whatsapp_api_example' AND status = 'FAILED'`,
      [orgA],
    );
    expect(failed[0]?.status).toBe('FAILED');
  });
});
