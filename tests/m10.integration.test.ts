import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeRecall,
  createRecallForCompletedAppointment,
  runRecallTick,
} from '../src/automation/recall';
import {
  DEFAULT_RECALL_CONFIG,
  RECALL_CONFIG_META_KEY,
  loadRecallConfig,
} from '../src/automation/recallConfig';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import { registerProvider } from '../src/communications/registry';
import { MockProvider } from '../src/communications/mockProvider';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';

const testHost = process.env.TEST_DB_HOST;
const HOUR = 3_600_000;
const MINUTE = 60_000;

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

interface RecallRow extends mysql.RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  recall_type: string;
  due_date: string;
  status: string;
  last_contacted_at: Date | null;
  rebooked_appointment_id: number | null;
  anchor_appointment_id: number | null;
  close_reason: string | null;
  closed_at: Date | null;
}

interface RecallMessageRow extends mysql.RowDataPacket {
  id: number;
  recall_id: number;
  phase: string;
  status: string;
  scheduled_at: Date;
  sent_at: Date | null;
  message_id: number | null;
  attempts: number;
  last_error: string | null;
  suppression_reason: string | null;
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
}

function utcDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * HOUR).toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe.skipIf(testHost === undefined || testHost === '')(
  'M10 acceptance: recall automation',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgId: number;
    const ownerEmail = 'owner.m10@apextest.local';
    const ownerPassword = 'OwnerM10Passw0rd!26x';
    let ownerCookie: string;
    let phoneSeq = 0;

    async function insertOrg(name: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
        [name, generateSiteKey()],
      );
      return row.insertId;
    }

    async function insertUser(
      organizationId: number,
      email: string,
      password: string,
      role: string,
    ): Promise<number> {
      const hash = await hashPassword(password);
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [organizationId, email, hash, role],
      );
      return row.insertId;
    }

    async function login(email: string, password: string): Promise<string> {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      expect(res.status).toBe(200);
      return cookie(res);
    }

    async function freshPatient(first: string, phone?: string): Promise<number> {
      phoneSeq += 1;
      const res = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: first,
          lastName: 'M10',
          phone: phone ?? `15550310${String(phoneSeq).padStart(4, '0')}`,
        });
      expect(res.status).toBe(201);
      return res.body.patient.id as number;
    }

    function createAppt(
      patientId: number,
      body: Record<string, unknown>,
    ): request.Test {
      return request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ownerCookie)
        .send({ patientId, ...body });
    }

    function appointmentPath(appointmentId: number, action?: string): string {
      const base = `/api/organizations/${orgId}/appointments/${appointmentId}`;
      return action === undefined ? base : `${base}/${action}`;
    }

    async function completeApp(appointmentId: number): Promise<request.Response> {
      return request(app)
        .post(appointmentPath(appointmentId, 'complete'))
        .set('Cookie', ownerCookie)
        .send({});
    }

    async function recallsForPatient(patientId: number): Promise<RecallRow[]> {
      const [rows] = await pool.query<RecallRow[]>(
        `SELECT id, organization_id, patient_id, recall_type,
           DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, status, last_contacted_at,
           rebooked_appointment_id, anchor_appointment_id, close_reason, closed_at
         FROM recalls WHERE patient_id = ? ORDER BY id ASC`,
        [patientId],
      );
      return rows;
    }

    async function recallMessages(recallId: number): Promise<RecallMessageRow[]> {
      const [rows] = await pool.query<RecallMessageRow[]>(
        `SELECT id, recall_id, phase, status, scheduled_at, sent_at, message_id,
           attempts, last_error, suppression_reason
         FROM recall_messages WHERE recall_id = ? ORDER BY phase`,
        [recallId],
      );
      return rows;
    }

    async function messageByKey(key: string): Promise<MessageRow | null> {
      const [rows] = await pool.query<MessageRow[]>(
        `SELECT id, recipient, body, status, message_type, template, idempotency_key, provider_error
         FROM communication_messages WHERE idempotency_key = ?`,
        [key],
      );
      return rows[0] ?? null;
    }

    async function commCountForRecall(recallId: number): Promise<number> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM communication_messages
         WHERE idempotency_key IN (
           SELECT CONCAT('recall:', id) FROM recall_messages WHERE recall_id = ?
         )`,
        [recallId],
      );
      return rows[0]?.total ?? 0;
    }

    async function setRecallConfig(patch: Record<string, unknown>): Promise<void> {
      const current = await loadRecallConfig(pool);
      const merged: Record<string, unknown> = {
        ...current,
        ...patch,
        templates: { ...current.templates, ...((patch.templates as object) ?? {}) },
      };
      await pool.query(
        `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [RECALL_CONFIG_META_KEY, JSON.stringify(merged)],
      );
    }

    async function resetRecallConfig(): Promise<void> {
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [RECALL_CONFIG_META_KEY]);
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
      await resetRecallConfig();
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['noshow_config']);
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['reminder_config']);

      orgId = await insertOrg('M10 Clinic');
      await insertUser(orgId, ownerEmail, ownerPassword, 'owner');

      logger = captureLogger();
      app = createApp({ db: pool, logger });
      ownerCookie = await login(ownerEmail, ownerPassword);
    }, 30_000);

    afterAll(async () => {
      registerProvider(new MockProvider());
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('runs the TEST 9 flow: overdue recall, message, follow-up, books, closes', async () => {
      const patientId = await freshPatient('Alice');
      const yesterday = utcDay(-1);
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 1 });

        const created = await createAppt(patientId, {
          date: yesterday,
          time: '10:00',
          service: 'Check-up',
        });
        expect(created.status).toBe(201);
        const apptId = created.body.appointment.id as number;

        const done = await completeApp(apptId);
        expect(done.status).toBe(200);

        const recalls = await recallsForPatient(patientId);
        expect(recalls).toHaveLength(1);
        const recall = recalls[0];
        const recallId = recall?.id ?? 0;
        expect(recall?.status).toBe('CONTACTED');
        expect(recall?.due_date).toBe(addDays(yesterday, 1));
        expect(recall?.recall_type).toBe('hygiene');
        expect(recall?.anchor_appointment_id).toBe(apptId);
        expect(recall?.organization_id).toBe(orgId);
        expect(recall?.last_contacted_at).not.toBeNull();
        expect(recall?.closed_at).toBeNull();

        const rows = await recallMessages(recallId);
        expect(rows.map((r) => r.phase)).toEqual(['INITIAL', 'FOLLOW_UP']);
        const initial = rows.find((r) => r.phase === 'INITIAL');
        const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
        expect(initial?.status).toBe('SENT');
        expect(initial?.message_id).not.toBeNull();
        expect(followUp?.status).toBe('PENDING');
        const dueAt = new Date(`${addDays(yesterday, 1)}T00:00:00.000Z`).getTime();
        expect(Math.abs((followUp?.scheduled_at.getTime() ?? 0) - (dueAt + HOUR))).toBeLessThan(
          5 * MINUTE,
        );

        const msg = await messageByKey(`recall:${initial?.id ?? 0}`);
        expect(msg?.status).toBe('SENT');
        expect(msg?.message_type).toBe('recall_message');
        expect(msg?.body).toContain('Alice');
        expect(msg?.body).toContain('M10 Clinic');
        expect(msg?.body).not.toContain('{{');
        expect(await commCountForRecall(recallId)).toBe(1);

        const dupComplete = await completeApp(apptId);
        expect(dupComplete.status).toBe(409);
        const direct = await createRecallForCompletedAppointment(pool, logger, {
          appointmentId: apptId,
        });
        expect(direct.created).toBe(false);
        expect(direct.reason).toBe('already_exists');
        expect(await recallsForPatient(patientId)).toHaveLength(1);

        const followTick = await runRecallTick(pool, logger, {
          now: new Date(dueAt + HOUR + MINUTE),
        });
        expect(followTick.processed).toBeGreaterThanOrEqual(0);
        const afterFollow = await recallMessages(recallId);
        expect(afterFollow.find((r) => r.phase === 'FOLLOW_UP')?.status).toBe('SENT');
        expect(await commCountForRecall(recallId)).toBe(2);
        const followMsg = await messageByKey(
          `recall:${afterFollow.find((r) => r.phase === 'FOLLOW_UP')?.id ?? 0}`,
        );
        expect(followMsg?.message_type).toBe('recall_follow_up');
        expect((await recallsForPatient(patientId))[0]?.status).toBe('CONTACTED');

        const booked = await createAppt(patientId, { date: '2026-11-01', time: '09:30' });
        expect(booked.status).toBe(201);
        const bookedId = booked.body.appointment.id as number;
        const closed = (await recallsForPatient(patientId))[0];
        expect(closed?.status).toBe('BOOKED');
        expect(closed?.rebooked_appointment_id).toBe(bookedId);
        expect(closed?.close_reason).toBe('booked');
        expect(closed?.closed_at).not.toBeNull();

        const late = await runRecallTick(pool, logger, { now: new Date(Date.now() + 48 * HOUR) });
        expect(late.processed).toBe(0);
        const final = (await recallsForPatient(patientId))[0];
        expect(final?.status).toBe('BOOKED');
        expect(await commCountForRecall(recallId)).toBe(2);
      } finally {
        await resetRecallConfig();
      }
    });

    it('calculates the due date from the configured interval and sends when due', async () => {
      const patientId = await freshPatient('Bob');
      try {
        await setRecallConfig({ intervalDays: 30, followUpDelayHours: 4 });

        const created = await createAppt(patientId, {
          date: '2026-10-05',
          time: '11:00',
          service: 'Cleaning',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);

        const recalls = await recallsForPatient(patientId);
        expect(recalls).toHaveLength(1);
        const recallId = recalls[0]?.id ?? 0;
        expect(recalls[0]?.due_date).toBe('2026-11-04');
        expect(recalls[0]?.status).toBe('DUE');

        const rows = await recallMessages(recallId);
        expect(rows.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
        const initial = rows.find((r) => r.phase === 'INITIAL');
        const dueAt = new Date('2026-11-04T00:00:00.000Z').getTime();
        expect(Math.abs((initial?.scheduled_at.getTime() ?? 0) - dueAt)).toBeLessThan(5 * MINUTE);

        const before = await runRecallTick(pool, logger, { now: new Date(dueAt - MINUTE) });
        expect(before.processed).toBe(0);
        expect((await recallsForPatient(patientId))[0]?.status).toBe('DUE');

        const tick = await runRecallTick(pool, logger, { now: new Date(dueAt + HOUR) });
        expect(tick.processed).toBeGreaterThanOrEqual(1);
        const after = await recallMessages(recallId);
        expect(after.find((r) => r.phase === 'INITIAL')?.status).toBe('SENT');
        expect((await recallsForPatient(patientId))[0]?.status).toBe('CONTACTED');
        expect(await commCountForRecall(recallId)).toBe(1);
      } finally {
        await resetRecallConfig();
      }
    });

    it('prevents duplicate cycles: service is idempotent and a new visit replaces the cycle', async () => {
      const patientId = await freshPatient('Cara');
      try {
        await setRecallConfig({ intervalDays: 180, followUpDelayHours: 72 });

        const first = await createAppt(patientId, {
          date: '2026-09-26',
          time: '09:00',
          service: 'Check-up',
        });
        const firstId = first.body.appointment.id as number;
        expect((await completeApp(firstId)).status).toBe(200);
        expect(await recallsForPatient(patientId)).toHaveLength(1);

        const again = await createRecallForCompletedAppointment(pool, logger, {
          appointmentId: firstId,
        });
        expect(again.created).toBe(false);
        expect(again.reason).toBe('already_exists');
        expect(await recallsForPatient(patientId)).toHaveLength(1);

        const second = await createAppt(patientId, {
          date: '2026-09-27',
          time: '09:00',
          service: 'Check-up',
        });
        const secondId = second.body.appointment.id as number;
        expect((await completeApp(secondId)).status).toBe(200);

        const all = await recallsForPatient(patientId);
        expect(all).toHaveLength(2);
        const open = all.filter((r) => r.status === 'DUE' || r.status === 'CONTACTED');
        expect(open).toHaveLength(1);
        expect(open[0]?.anchor_appointment_id).toBe(secondId);
        const replaced = all.find((r) => r.anchor_appointment_id === firstId);
        expect(replaced?.status).toBe('COMPLETED');
        expect(replaced?.close_reason).toBe('visit_completed');

        const direct = await createRecallForCompletedAppointment(pool, logger, {
          appointmentId: secondId,
        });
        expect(direct.created).toBe(false);
        expect(direct.reason).toBe('already_exists');
        expect(await recallsForPatient(patientId)).toHaveLength(2);
      } finally {
        await resetRecallConfig();
      }
    });

    it('closes the recall as BOOKED when the patient books and cancels the follow-up', async () => {
      const patientId = await freshPatient('Dana');
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 72 });

        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '12:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);
        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;
        expect((await recallMessages(recallId)).find((r) => r.phase === 'INITIAL')?.status).toBe(
          'SENT',
        );

        const booked = await createAppt(patientId, { date: '2026-11-02', time: '14:00' });
        expect(booked.status).toBe(201);
        const bookedId = booked.body.appointment.id as number;

        const recall = (await recallsForPatient(patientId))[0];
        expect(recall?.status).toBe('BOOKED');
        expect(recall?.rebooked_appointment_id).toBe(bookedId);
        const followUp = (await recallMessages(recallId)).find((r) => r.phase === 'FOLLOW_UP');
        expect(followUp?.status).toBe('CANCELLED');
        expect(followUp?.suppression_reason).toBe('booked');

        const again = await createAppt(patientId, { date: '2026-11-03', time: '15:00' });
        expect(again.status).toBe(201);
        const after = (await recallsForPatient(patientId))[0];
        expect(after?.status).toBe('BOOKED');
        expect(after?.rebooked_appointment_id).toBe(bookedId);

        await runRecallTick(pool, logger, { now: new Date(Date.now() + 100 * HOUR) });
        expect((await recallsForPatient(patientId))[0]?.status).toBe('BOOKED');
        expect(await commCountForRecall(recallId)).toBe(1);
      } finally {
        await resetRecallConfig();
      }
    });

    it('lazily closes the recall on a booking created outside the API', async () => {
      const patientId = await freshPatient('Evan');
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 72 });

        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '08:30',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);
        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;

        await pool.query(
          `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time, service)
           VALUES (?, ?, '2026-11-05', '10:00', 'Walk-in import')`,
          [orgId, patientId],
        );

        const tick = await runRecallTick(pool, logger);
        expect(tick.booked).toBeGreaterThanOrEqual(1);

        const recall = (await recallsForPatient(patientId))[0];
        expect(recall?.status).toBe('BOOKED');
        expect(recall?.rebooked_appointment_id).not.toBeNull();
        expect(recall?.close_reason).toBe('booked');
        const followUp = (await recallMessages(recallId)).find((r) => r.phase === 'FOLLOW_UP');
        expect(followUp?.status).toBe('CANCELLED');
        expect(await commCountForRecall(recallId)).toBe(1);
      } finally {
        await resetRecallConfig();
      }
    });

    it('supports manual staff closure, repeat 404, and tenant isolation', async () => {
      const patientId = await freshPatient('Farah');
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 72 });

        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '16:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);
        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;

        const otherOrg = await insertOrg('M10 Other Clinic');
        const cross = await request(app)
          .post(`/api/organizations/${otherOrg}/recalls/${recallId}/close`)
          .set('Cookie', ownerCookie)
          .send({});
        expect(cross.status).toBe(404);
        expect((await recallsForPatient(patientId))[0]?.status).toBe('CONTACTED');

        const close = await request(app)
          .post(`/api/organizations/${orgId}/recalls/${recallId}/close`)
          .set('Cookie', ownerCookie)
          .send({ reason: 'Patient moved away' });
        expect(close.status).toBe(200);
        expect(close.body.recall.status).toBe('CLOSED');
        expect(close.body.recall.closeReason).toBe('Patient moved away');

        const rows = await recallsForPatient(patientId);
        expect(rows[0]?.status).toBe('CLOSED');
        expect(rows[0]?.close_reason).toBe('Patient moved away');
        expect(rows[0]?.closed_at).not.toBeNull();
        const messages = await recallMessages(recallId);
        expect(messages.find((r) => r.phase === 'FOLLOW_UP')?.status).toBe('CANCELLED');
        expect(messages.find((r) => r.phase === 'FOLLOW_UP')?.suppression_reason).toBe(
          'Patient moved away',
        );

        const again = await request(app)
          .post(`/api/organizations/${orgId}/recalls/${recallId}/close`)
          .set('Cookie', ownerCookie)
          .send({});
        expect(again.status).toBe(404);

        const tick = await runRecallTick(pool, logger, { now: new Date(Date.now() + 50 * HOUR) });
        expect(tick.processed).toBe(0);
        expect(await commCountForRecall(recallId)).toBe(1);
      } finally {
        await resetRecallConfig();
      }
    });

    it('marks a booked recall COMPLETED when that visit completes and opens the next cycle', async () => {
      const patientId = await freshPatient('Grace');
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 72 });

        const first = await createAppt(patientId, {
          date: utcDay(-1),
          time: '10:15',
          service: 'Check-up',
        });
        const firstId = first.body.appointment.id as number;
        expect((await completeApp(firstId)).status).toBe(200);
        const firstRecallId = (await recallsForPatient(patientId))[0]?.id ?? 0;

        const booked = await createAppt(patientId, { date: '2026-11-10', time: '11:30' });
        const bookedId = booked.body.appointment.id as number;
        expect((await recallsForPatient(patientId))[0]?.status).toBe('BOOKED');

        expect((await completeApp(bookedId)).status).toBe(200);

        const all = await recallsForPatient(patientId);
        expect(all).toHaveLength(2);
        const flipped = all.find((r) => r.id === firstRecallId);
        expect(flipped?.status).toBe('COMPLETED');
        expect(flipped?.close_reason).toBe('visit_completed');
        expect(flipped?.closed_at).not.toBeNull();
        const open = all.filter((r) => r.status === 'DUE' || r.status === 'CONTACTED');
        expect(open).toHaveLength(1);
        expect(open[0]?.anchor_appointment_id).toBe(bookedId);
        expect(open[0]?.due_date).toBe('2026-11-11');
        const nextMessages = await recallMessages(open[0]?.id ?? 0);
        expect(nextMessages.map((r) => r.phase)).toEqual(['INITIAL', 'FOLLOW_UP']);
        expect(nextMessages.map((r) => r.status)).toEqual(['PENDING', 'PENDING']);
      } finally {
        await resetRecallConfig();
      }
    });

    it('does not create a recall while the config is disabled', async () => {
      const patientId = await freshPatient('Hana');
      try {
        await setRecallConfig({ enabled: false });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '13:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);
        expect(await recallsForPatient(patientId)).toHaveLength(0);

        const tick = await runRecallTick(pool, logger);
        expect(tick).toEqual({
          processed: 0,
          sent: 0,
          failed: 0,
          suppressed: 0,
          cancelled: 0,
          booked: 0,
        });
      } finally {
        await resetRecallConfig();
      }
    });

    it('falls back to defaults on corrupt config', async () => {
      try {
        await pool.query(
          `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, 'not-json')
           ON DUPLICATE KEY UPDATE meta_value = 'not-json'`,
          [RECALL_CONFIG_META_KEY],
        );
        const loaded = await loadRecallConfig(pool);
        expect(loaded).toEqual(DEFAULT_RECALL_CONFIG);
      } finally {
        await resetRecallConfig();
      }
    });

    it('honors custom templates and renders missing variables empty', async () => {
      const patientId = await freshPatient('Ivan');
      try {
        await setRecallConfig({
          intervalDays: 30,
          followUpDelayHours: 2,
          templates: {
            recall: 'RECALL {{first_name}} [{{booking_link}}|{{clinic_phone}}].',
            followUp: 'FOLLOW {{clinic_name}}.',
          },
        });

        const created = await createAppt(patientId, {
          date: '2026-10-05',
          time: '17:45',
          service: 'Cleaning',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);

        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;
        const dueAt = new Date('2026-11-04T00:00:00.000Z').getTime();
        const tick = await runRecallTick(pool, logger, { now: new Date(dueAt + MINUTE) });
        expect(tick.sent).toBeGreaterThanOrEqual(1);

        const rows = await recallMessages(recallId);
        const initial = rows.find((r) => r.phase === 'INITIAL');
        expect(initial?.status).toBe('SENT');
        const msg = await messageByKey(`recall:${initial?.id ?? 0}`);
        expect(msg?.body).toBe('RECALL Ivan [|].');
        expect(msg?.body).not.toContain('{{');
        expect((await recallsForPatient(patientId))[0]?.status).toBe('CONTACTED');
      } finally {
        await resetRecallConfig();
      }
    });

    it('suppresses both phases when the patient has opted out', async () => {
      const patientId = await freshPatient('Jade');
      try {
        const patch = await request(app)
          .patch(`/api/organizations/${orgId}/patients/${patientId}`)
          .set('Cookie', ownerCookie)
          .send({ smsOptOut: true });
        expect(patch.status).toBe(200);

        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 1 });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '09:45',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);

        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;
        let rows = await recallMessages(recallId);
        expect(rows.find((r) => r.phase === 'INITIAL')?.status).toBe('SUPPRESSED');
        expect(rows.find((r) => r.phase === 'INITIAL')?.suppression_reason).toBe(
          'communication_not_permitted',
        );
        expect((await recallsForPatient(patientId))[0]?.status).toBe('DUE');
        expect((await recallsForPatient(patientId))[0]?.last_contacted_at).toBeNull();

        const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
        const tick = await runRecallTick(pool, logger, {
          now: new Date((followUp?.scheduled_at.getTime() ?? 0) + MINUTE),
        });
        expect(tick.suppressed).toBeGreaterThanOrEqual(1);
        rows = await recallMessages(recallId);
        expect(rows.find((r) => r.phase === 'FOLLOW_UP')?.status).toBe('SUPPRESSED');
        expect(await commCountForRecall(recallId)).toBe(0);
        expect((await recallsForPatient(patientId))[0]?.status).toBe('DUE');
      } finally {
        await resetRecallConfig();
      }
    });

    it('backs off failed sends and stops at max attempts', async () => {
      const patientId = await freshPatient('Fred', '999999999');
      try {
        await setRecallConfig({ intervalDays: 1, followUpDelayHours: 72 });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '08:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        const t0 = Date.now();
        expect((await completeApp(apptId)).status).toBe(200);

        const recallId = (await recallsForPatient(patientId))[0]?.id ?? 0;
        let rows = await recallMessages(recallId);
        const initial = rows.find((r) => r.phase === 'INITIAL');
        expect(initial?.status).toBe('FAILED');
        expect(initial?.attempts).toBe(1);
        expect(initial?.last_error).toContain('mock_recipient_failure');
        expect(initial?.message_id).not.toBeNull();
        const backoff1 = initial?.scheduled_at.getTime() ?? 0;
        expect(backoff1).toBeGreaterThan(t0 + 45_000);
        expect(backoff1).toBeLessThan(t0 + 75_000);

        const beforeBackoff = await runRecallTick(pool, logger, { now: new Date(t0 + 1_000) });
        expect(beforeBackoff.processed).toBe(0);

        const second = await runRecallTick(pool, logger, { now: new Date(t0 + 70_000) });
        expect(second.failed).toBe(1);
        rows = await recallMessages(recallId);
        expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(2);

        const third = await runRecallTick(pool, logger, { now: new Date(t0 + 200_000) });
        expect(third.failed).toBe(1);
        rows = await recallMessages(recallId);
        expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(3);
        expect(rows.find((r) => r.phase === 'INITIAL')?.status).toBe('FAILED');

        const stopped = await runRecallTick(pool, logger, { now: new Date(t0 + 600_000) });
        expect(stopped.processed).toBe(0);
        rows = await recallMessages(recallId);
        expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(3);

        const msg = await messageByKey(`recall:${initial?.id ?? 0}`);
        expect(msg?.status).toBe('FAILED');
        expect(msg?.recipient).toBe('999999999');
        expect((await recallsForPatient(patientId))[0]?.status).toBe('DUE');
      } finally {
        await resetRecallConfig();
      }
    });

    it('handles unknown ids without throwing', async () => {
      const created = await createRecallForCompletedAppointment(pool, logger, {
        appointmentId: 999_999_999,
      });
      expect(created).toEqual({
        created: false,
        recallId: null,
        dueDate: null,
        reason: 'appointment_not_completed',
      });
      const closed = await closeRecall(pool, logger, {
        recallId: 999_999_999,
        reason: 'staff_closed',
      });
      expect(closed).toEqual({ closed: false, recallId: null, status: null });

      const routeClose = await request(app)
        .post(`/api/organizations/${orgId}/recalls/999999999/close`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(routeClose.status).toBe(404);
    });
  },
);
