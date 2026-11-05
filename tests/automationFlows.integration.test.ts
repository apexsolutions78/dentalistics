import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import type mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACK_CONFIG_META_KEY, DEFAULT_ACK_CONFIG, loadAckConfig } from '../src/automation/config';
import { refreshLeadAutomation } from '../src/automation/leadAutomation';
import { triggerLeadCreated } from '../src/automation/leadCreated';
import {
  DEFAULT_REMINDER_CONFIG,
  REMINDER_CONFIG_META_KEY,
  cloneReminderConfig,
  loadReminderConfig,
} from '../src/automation/reminderConfig';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import type { DbConfig } from '../src/config';
import { loadOrgEnabledFilter } from '../src/db/orgMeta';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';

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

function logger(): Logger {
  const silent = (): void => undefined;
  return { debug: silent, info: silent, warn: silent, error: silent, child: () => logger() };
}

describe.skipIf(testHost === undefined || testHost === '')('clinic automation switches', () => {
  let pool: mysql.Pool;
  let app: Express;
  let orgId: number;
  let otherOrgId: number;
  const ownerEmail = 'flows.owner@example.test';
  const ownerPassword = 'FlowsOwnerPass1';
  const deskEmail = 'flows.desk@example.test';
  const deskPassword = 'FlowsDeskPass1';
  const adminEmail = 'flows.admin@example.test';
  const adminPassword = 'FlowsAdminPass1';
  const customAck = 'Custom ack for {{first_name}}';

  beforeAll(async () => {
    const cfg = testDbConfig();
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    const [org] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, plan, trial_ends_at) VALUES ('Flow Clinic', 'full', NULL)`,
    );
    orgId = org.insertId;
    const [other] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, plan, trial_ends_at) VALUES ('Other Flow Clinic', 'full', NULL)`,
    );
    otherOrgId = other.insertId;
    async function insertUser(
      email: string,
      password: string,
      role: string,
      organizationId: number | null,
    ): Promise<void> {
      const hash = await hashPassword(password);
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [organizationId, email, hash, role],
      );
    }
    await insertUser(ownerEmail, ownerPassword, 'owner', orgId);
    await insertUser(deskEmail, deskPassword, 'receptionist', orgId);
    await insertUser(adminEmail, adminPassword, 'admin', null);

    const ack = { ...DEFAULT_ACK_CONFIG, sources: [...DEFAULT_ACK_CONFIG.sources], template: customAck };
    const reminder = cloneReminderConfig(DEFAULT_REMINDER_CONFIG);
    reminder.offsetsHours = [12];
    await pool.query(
      `INSERT INTO organization_settings (organization_id, meta_key, meta_value) VALUES (?, ?, ?), (?, ?, ?)`,
      [
        orgId,
        ACK_CONFIG_META_KEY,
        JSON.stringify(ack),
        orgId,
        REMINDER_CONFIG_META_KEY,
        JSON.stringify(reminder),
      ],
    );
    await pool.query(
      `INSERT INTO communication_messages
        (organization_id, channel, recipient, body, status, idempotency_key, message_type, created_at)
       VALUES (?, 'SMS', '15550001111', 'ack', 'SENT', ?, 'lead_acknowledgement', UTC_TIMESTAMP())`,
      [orgId, `flows-ack-${orgId}`],
    );
    await pool.query(
      `INSERT INTO communication_messages
        (organization_id, channel, recipient, body, status, idempotency_key, message_type, created_at)
       VALUES (?, 'SMS', '15550002222', 'other', 'SENT', ?, 'lead_acknowledgement', UTC_TIMESTAMP())`,
      [otherOrgId, `flows-ack-${otherOrgId}`],
    );
    app = createApp({ db: pool, logger: logger() });
  }, 30_000);

  afterAll(async () => {
    if (pool !== undefined) {
      const ids = [orgId, otherOrgId].filter((id) => id !== undefined);
      await pool.query('DELETE FROM communication_messages WHERE organization_id IN (?)', [ids]);
      await pool.query('DELETE FROM leads WHERE organization_id IN (?)', [ids]);
      await pool.query('DELETE FROM organization_settings WHERE organization_id IN (?)', [ids]);
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
        'flows.%@example.test',
      ]);
      await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
        'flows.%@example.test',
      ]);
      await pool.query('DELETE FROM users WHERE email LIKE ?', ['flows.%@example.test']);
      await pool.query('DELETE FROM organizations WHERE id IN (?)', [ids]);
      await pool.end();
    }
  });

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookie(res);
  }

  it('lists the real flows with a 30-day count scoped to the clinic', async () => {
    const sid = await login(ownerEmail, ownerPassword);
    const res = await request(app).get(`/api/organizations/${orgId}/automation-flows`).set('Cookie', sid);
    expect(res.status).toBe(200);
    const keys = (res.body.flows as Array<{ key: string }>).map((flow) => flow.key);
    expect(keys).toEqual([
      'lead_ack',
      'missed_call',
      'reminders',
      'no_show',
      'recall',
      'reviews',
      'lead_automation',
    ]);
    const ack = (res.body.flows as Array<{ key: string; runsLast30Days: number; lastRunAt: string | null }>).find(
      (flow) => flow.key === 'lead_ack',
    );
    expect(ack?.runsLast30Days).toBe(1);
    expect(ack?.lastRunAt).not.toBeNull();

    const otherClinic = await request(app)
      .get(`/api/organizations/${otherOrgId}/automation-flows`)
      .set('Cookie', sid);
    expect(otherClinic.status).toBe(404);

    const desk = await login(deskEmail, deskPassword);
    const readable = await request(app).get(`/api/organizations/${orgId}/automation-flows`).set('Cookie', desk);
    expect(readable.status).toBe(200);
    expect(readable.body.flows).toHaveLength(7);
  });

  it('lets only the owner turn a flow off, and the runner then skips it', async () => {
    const owner = await login(ownerEmail, ownerPassword);
    const desk = await login(deskEmail, deskPassword);
    const admin = await login(adminEmail, adminPassword);

    const deniedDesk = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/lead_ack`)
      .set('Cookie', desk)
      .send({ enabled: false });
    expect(deniedDesk.status).toBe(403);

    const deniedAdmin = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/lead_ack`)
      .set('Cookie', admin)
      .send({ enabled: false });
    expect(deniedAdmin.status).toBe(403);

    const saved = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/lead_ack`)
      .set('Cookie', owner)
      .send({ enabled: false });
    expect(saved.status).toBe(200);
    expect(saved.body.flow.enabled).toBe(false);

    const ack = await loadAckConfig(pool, orgId);
    expect(ack.enabled).toBe(false);
    expect(ack.template).toBe(customAck);

    const [lead] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO leads (organization_id, first_name, last_name, phone, source, status)
       VALUES (?, 'Nia', 'Patient', '15550003333', 'WEBSITE', 'NEW')`,
      [orgId],
    );
    const result = await triggerLeadCreated(pool, logger(), {
      organizationId: orgId,
      leadId: lead.insertId,
    });
    expect(result.action).toBe('skipped_disabled');
    const [messages] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id FROM communication_messages WHERE lead_id = ?',
      [lead.insertId],
    );
    expect(messages).toHaveLength(0);

    const reminders = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/reminders`)
      .set('Cookie', owner)
      .send({ enabled: false });
    expect(reminders.status).toBe(200);
    const reminder = await loadReminderConfig(pool, orgId);
    expect(reminder.enabled).toBe(false);
    expect(reminder.offsetsHours).toEqual([12]);
    const global = await loadReminderConfig(pool);
    const filter = await loadOrgEnabledFilter(pool, REMINDER_CONFIG_META_KEY, global.enabled, 'organization_id');
    const listed = filter.params.flat();
    if (global.enabled) {
      expect(filter.clause).toContain('NOT IN');
      expect(listed).toContain(orgId);
    } else {
      expect(listed).not.toContain(orgId);
    }

    const leadAutomation = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/lead_automation`)
      .set('Cookie', owner)
      .send({ enabled: false });
    expect(leadAutomation.status).toBe(200);
    const refreshed = await refreshLeadAutomation(pool, logger(), {
      organizationId: orgId,
      leadId: lead.insertId,
    });
    expect(refreshed).toEqual({ urgency: null, suggestions: 0, enabled: false });
  });

  it('rejects an unknown flow and a non-boolean switch', async () => {
    const sid = await login(ownerEmail, ownerPassword);
    const missing = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/billing`)
      .set('Cookie', sid)
      .send({ enabled: false });
    expect(missing.status).toBe(404);
    const bad = await request(app)
      .patch(`/api/organizations/${orgId}/automation-flows/recall`)
      .set('Cookie', sid)
      .send({ enabled: 'no' });
    expect(bad.status).toBe(400);
  });
});
