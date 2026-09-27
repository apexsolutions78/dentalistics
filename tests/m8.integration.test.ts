import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelRemindersForAppointment,
  runReminderTick,
  scheduleRemindersForAppointment,
} from '../src/automation/reminders';
import {
  DEFAULT_REMINDER_CONFIG,
  REMINDER_CONFIG_META_KEY,
  loadReminderConfig,
} from '../src/automation/reminderConfig';
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

interface ReminderRow extends mysql.RowDataPacket {
  id: number;
  appointment_id: number;
  offset_hours: number;
  scheduled_at: Date;
  status: string;
  message_id: number | null;
  attempts: number;
  last_error: string | null;
  suppression_reason: string | null;
  sent_at: Date | null;
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

describe.skipIf(testHost === undefined || testHost === '')(
  'M8 acceptance: appointment reminders',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgAId: number;
    let orgTzId: number;

    const ownerAEmail = 'owner.m8A@apextest.local';
    const ownerAPassword = 'OwnerM8APassw0rd!26x';
    const ownerTzEmail = 'owner.m8Tz@apextest.local';
    const ownerTzPassword = 'OwnerM8TzPassw0rd!26x';

    let ownerACookie: string;
    let ownerTzCookie: string;

    let patientAId = 0;
    let patientFailId = 0;
    let patientTzId = 0;

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

    async function createPatient(
      ck: string,
      orgId: number,
      body: Record<string, unknown>,
    ): Promise<number> {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ck)
        .send(body);
      expect(res.status).toBe(201);
      return res.body.patient.id as number;
    }

    function createAppt(
      ck: string,
      orgId: number,
      body: Record<string, unknown>,
    ): request.Test {
      return request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ck)
        .send(body);
    }

    function appointmentPath(orgId: number, appointmentId: number, action?: string): string {
      const base = `/api/organizations/${orgId}/appointments/${appointmentId}`;
      return action === undefined ? base : `${base}/${action}`;
    }

    async function reminderRows(appointmentId: number): Promise<ReminderRow[]> {
      const [rows] = await pool.query<ReminderRow[]>(
        `SELECT id, appointment_id, offset_hours, scheduled_at, status, message_id,
           attempts, last_error, suppression_reason, sent_at
         FROM appointment_reminders
         WHERE appointment_id = ?
         ORDER BY offset_hours DESC`,
        [appointmentId],
      );
      return rows;
    }

    async function backdate(appointmentId: number, offsetHours: number): Promise<void> {
      await pool.query(
        `UPDATE appointment_reminders
         SET scheduled_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 SECOND)
         WHERE appointment_id = ? AND offset_hours = ?`,
        [appointmentId, offsetHours],
      );
    }

    async function messageByKey(key: string): Promise<MessageRow | null> {
      const [rows] = await pool.query<MessageRow[]>(
        `SELECT id, recipient, body, status, message_type, template, idempotency_key, provider_error
         FROM communication_messages WHERE idempotency_key = ?`,
        [key],
      );
      return rows[0] ?? null;
    }

    async function countMessages(): Promise<number> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM communication_messages',
      );
      return rows[0]?.total ?? 0;
    }

    async function setReminderConfig(patch: Record<string, unknown>): Promise<void> {
      const current = await loadReminderConfig(pool);
      const merged: Record<string, unknown> = {
        ...current,
        ...patch,
        quietHours: { ...current.quietHours, ...((patch.quietHours as object) ?? {}) },
        templates: { ...current.templates, ...((patch.templates as object) ?? {}) },
      };
      await pool.query(
        `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [REMINDER_CONFIG_META_KEY, JSON.stringify(merged)],
      );
    }

    async function resetReminderConfig(): Promise<void> {
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [REMINDER_CONFIG_META_KEY]);
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
      await pool.query('DELETE FROM appointment_reminders');
      await pool.query('DELETE FROM appointments');
      await pool.query('DELETE FROM communication_messages');
      await pool.query('DELETE FROM lead_activities');
      await pool.query('DELETE FROM leads');
      await pool.query('DELETE FROM patients');
      await pool.query('DELETE FROM users');
      await pool.query('DELETE FROM organizations');
      await resetReminderConfig();

      orgAId = await insertOrg('M8 Clinic');
      orgTzId = await insertOrg('M8 TZ Clinic');

      await insertUser(orgAId, ownerAEmail, ownerAPassword, 'owner');
      await insertUser(orgTzId, ownerTzEmail, ownerTzPassword, 'owner');

      logger = captureLogger();
      app = createApp({ db: pool, logger });

      ownerACookie = await login(ownerAEmail, ownerAPassword);
      ownerTzCookie = await login(ownerTzEmail, ownerTzPassword);

      patientAId = await createPatient(ownerACookie, orgAId, {
        firstName: 'Alice',
        lastName: 'M8',
        phone: '+1 (555) 030-8001',
      });
      patientFailId = await createPatient(ownerACookie, orgAId, {
        firstName: 'Fred',
        lastName: 'M8',
        phone: '999999999',
      });
      patientTzId = await createPatient(ownerTzCookie, orgTzId, {
        firstName: 'Tara',
        lastName: 'M8',
        phone: '15550308003',
      });
    }, 30_000);

    afterAll(async () => {
      registerProvider(new MockProvider());
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('schedules exact UTC reminder instants for every configured offset', async () => {
      const res = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-11-05',
        time: '10:00',
        service: 'Check-up',
      });
      expect(res.status).toBe(201);
      const apptId = res.body.appointment.id as number;

      const rows = await reminderRows(apptId);
      expect(rows.map((r) => r.offset_hours)).toEqual([48, 24, 2]);
      expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
      expect(rows.every((r) => r.attempts === 0)).toBe(true);
      expect(rows[0]?.scheduled_at.toISOString()).toBe('2026-11-03T10:00:00.000Z');
      expect(rows[1]?.scheduled_at.toISOString()).toBe('2026-11-04T10:00:00.000Z');
      expect(rows[2]?.scheduled_at.toISOString()).toBe('2026-11-05T08:00:00.000Z');
      expect(rows.every((r) => r.message_id === null)).toBe(true);
    });

    it('skips offsets whose send time is already in the past', async () => {
      const soon = new Date(Date.now() + 6 * 3_600_000);
      const res = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: soon.toISOString().slice(0, 10),
        time: soon.toISOString().slice(11, 16),
      });
      expect(res.status).toBe(201);
      const apptId = res.body.appointment.id as number;

      const rows = await reminderRows(apptId);
      expect(rows.map((r) => r.offset_hours)).toEqual([2]);
      expect(rows[0]?.status).toBe('PENDING');
    });

    it('refuses to schedule reminders for inactive appointments', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-11-06',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;
      const cancel = await request(app)
        .post(appointmentPath(orgAId, apptId, 'cancel'))
        .set('Cookie', ownerACookie)
        .send({});
      expect(cancel.status).toBe(200);

      const again = await scheduleRemindersForAppointment(pool, logger, apptId);
      expect(again).toEqual({ scheduled: 0, skipped: 1 });
      const rows = await reminderRows(apptId);
      expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(0);
    });

    it('eagerly cancels reminders on cancel, complete and no-show', async () => {
      const cases: Array<[string, string]> = [
        ['cancel', 'appointment_cancelled'],
        ['complete', 'appointment_completed'],
        ['no-show', 'appointment_no_show'],
      ];
      let day = 10;
      for (const [action, reason] of cases) {
        const created = await createAppt(ownerACookie, orgAId, {
          patientId: patientAId,
          date: `2026-11-${String(day).padStart(2, '0')}`,
          time: '11:00',
        });
        const apptId = created.body.appointment.id as number;
        expect((await reminderRows(apptId)).filter((r) => r.status === 'PENDING')).toHaveLength(3);

        const res = await request(app)
          .post(appointmentPath(orgAId, apptId, action))
          .set('Cookie', ownerACookie)
          .send({});
        expect(res.status).toBe(200);

        const rows = await reminderRows(apptId);
        expect(rows.every((r) => r.status === 'CANCELLED')).toBe(true);
        expect(rows.every((r) => r.suppression_reason === reason)).toBe(true);
        day += 1;
      }
    });

    it('reschedule cancels old reminders and schedules for the new slot', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-11-20',
        time: '14:30',
        service: 'Filling',
      });
      const oldId = created.body.appointment.id as number;

      const res = await request(app)
        .post(appointmentPath(orgAId, oldId, 'reschedule'))
        .set('Cookie', ownerACookie)
        .send({ date: '2026-11-22', time: '16:45' });
      expect(res.status).toBe(200);
      const newId = res.body.appointment.id as number;

      const oldRows = await reminderRows(oldId);
      expect(oldRows.every((r) => r.status === 'CANCELLED')).toBe(true);
      expect(oldRows.every((r) => r.suppression_reason === 'appointment_rescheduled')).toBe(true);

      const newRows = await reminderRows(newId);
      expect(newRows.map((r) => r.offset_hours)).toEqual([48, 24, 2]);
      expect(newRows.every((r) => r.status === 'PENDING')).toBe(true);
      expect(newRows[0]?.scheduled_at.toISOString()).toBe('2026-11-20T16:45:00.000Z');
      expect(newRows[1]?.scheduled_at.toISOString()).toBe('2026-11-21T16:45:00.000Z');
      expect(newRows[2]?.scheduled_at.toISOString()).toBe('2026-11-22T14:45:00.000Z');
    });

    it('rebook schedules reminders for the rebooked appointment', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-11-23',
        time: '10:30',
      });
      const oldId = created.body.appointment.id as number;
      await request(app)
        .post(appointmentPath(orgAId, oldId, 'no-show'))
        .set('Cookie', ownerACookie)
        .send({});

      const rebook = await request(app)
        .post(appointmentPath(orgAId, oldId, 'rebook'))
        .set('Cookie', ownerACookie)
        .send({ date: '2026-11-25', time: '10:30' });
      expect(rebook.status).toBe(200);
      const newId = rebook.body.appointment.id as number;

      const rows = await reminderRows(newId);
      expect(rows.map((r) => r.offset_hours)).toEqual([48, 24, 2]);
      expect(rows.every((r) => r.status === 'PENDING')).toBe(true);
      expect(rows[0]?.scheduled_at.toISOString()).toBe('2026-11-23T10:30:00.000Z');
    });

    it('tick leaves future reminders untouched when nothing is due', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-01',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;
      const before = await reminderRows(apptId);
      const beforeMessages = await countMessages();

      const result = await runReminderTick(pool, logger);
      expect(result).toEqual({ processed: 0, sent: 0, failed: 0, suppressed: 0, cancelled: 0 });

      const after = await reminderRows(apptId);
      expect(after.map((r) => r.status)).toEqual(before.map((r) => r.status));
      expect(after.every((r) => r.message_id === null)).toBe(true);
      expect(await countMessages()).toBe(beforeMessages);
    });

    it('tick sends a due reminder with the rendered template exactly once', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-02',
        time: '10:00',
        service: 'Check-up',
      });
      const apptId = created.body.appointment.id as number;
      await backdate(apptId, 24);

      const rows = await reminderRows(apptId);
      const due = rows.find((r) => r.offset_hours === 24);
      expect(due).toBeDefined();
      const reminderId = due?.id ?? 0;
      const key = `reminder:${reminderId}`;

      const before = await countMessages();
      const result = await runReminderTick(pool, logger);
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0, suppressed: 0, cancelled: 0 });

      const after = await reminderRows(apptId);
      const sent = after.find((r) => r.offset_hours === 24);
      expect(sent?.status).toBe('SENT');
      expect(sent?.message_id).not.toBeNull();
      expect(sent?.attempts).toBe(1);
      expect(sent?.last_error).toBeNull();
      expect(sent?.sent_at).not.toBeNull();

      const msg = await messageByKey(key);
      expect(msg).not.toBeNull();
      expect(msg?.status).toBe('SENT');
      expect(msg?.recipient).toBe('15550308001');
      expect(msg?.message_type).toBe('appointment_reminder');
      expect(msg?.template).toBe('appointment_reminder_24h');
      expect(msg?.body).toBe(
        'Hi Alice, your appointment at M8 Clinic is tomorrow, 2026-12-02 at 10:00. See you soon!',
      );
      expect(msg?.body).not.toContain('{{');
      expect(await countMessages()).toBe(before + 1);

      const second = await runReminderTick(pool, logger);
      expect(second.processed).toBe(0);
      expect(await countMessages()).toBe(before + 1);
    });

    it('prevents duplicate reminders across repeated schedule and tick runs', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-05',
        time: '11:00',
      });
      const apptId = created.body.appointment.id as number;

      const again = await scheduleRemindersForAppointment(pool, logger, apptId);
      expect(again).toEqual({ scheduled: 0, skipped: 3 });
      expect(await reminderRows(apptId)).toHaveLength(3);

      await backdate(apptId, 48);
      const first = await runReminderTick(pool, logger);
      expect(first.sent).toBe(1);
      const afterFirst = await countMessages();

      const second = await runReminderTick(pool, logger);
      expect(second.processed).toBe(0);
      expect(await countMessages()).toBe(afterFirst);

      const rows = await reminderRows(apptId);
      expect(rows.filter((r) => r.status === 'SENT')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(2);
    });

    it('computes reminder instants in the clinic timezone including DST', async () => {
      const setTz = await request(app)
        .patch(`/api/organizations/${orgTzId}`)
        .set('Cookie', ownerTzCookie)
        .send({ timezone: 'America/New_York' });
      expect(setTz.status).toBe(200);

      const winter = await createAppt(ownerTzCookie, orgTzId, {
        patientId: patientTzId,
        date: '2027-01-15',
        time: '09:00',
      });
      expect(winter.status).toBe(201);
      const winterRows = await reminderRows(winter.body.appointment.id as number);
      expect(winterRows[0]?.scheduled_at.toISOString()).toBe('2027-01-13T14:00:00.000Z');
      expect(winterRows[1]?.scheduled_at.toISOString()).toBe('2027-01-14T14:00:00.000Z');

      const summer = await createAppt(ownerTzCookie, orgTzId, {
        patientId: patientTzId,
        date: '2027-07-10',
        time: '09:00',
      });
      expect(summer.status).toBe(201);
      const summerRows = await reminderRows(summer.body.appointment.id as number);
      expect(summerRows[1]?.scheduled_at.toISOString()).toBe('2027-07-09T13:00:00.000Z');

      const setTz2 = await request(app)
        .patch(`/api/organizations/${orgTzId}`)
        .set('Cookie', ownerTzCookie)
        .send({ timezone: 'Asia/Bahrain' });
      expect(setTz2.status).toBe(200);

      const bahrain = await createAppt(ownerTzCookie, orgTzId, {
        patientId: patientTzId,
        date: '2026-12-10',
        time: '12:00',
      });
      expect(bahrain.status).toBe(201);
      const bahrainRows = await reminderRows(bahrain.body.appointment.id as number);
      expect(bahrainRows[2]?.scheduled_at.toISOString()).toBe('2026-12-10T07:00:00.000Z');

      await request(app)
        .patch(`/api/organizations/${orgTzId}`)
        .set('Cookie', ownerTzCookie)
        .send({ timezone: 'UTC' });
    });

    it('suppresses sends during quiet hours and delivers outside them', async () => {
      const anchor = new Date();
      const hhmm = (d: Date): string => d.toISOString().slice(11, 16);
      await setReminderConfig({
        quietHours: {
          enabled: true,
          start: hhmm(new Date(anchor.getTime() - 3_600_000)),
          end: hhmm(new Date(anchor.getTime() + 3_600_000)),
        },
      });
      try {
        const suppressed = await createAppt(ownerACookie, orgAId, {
          patientId: patientAId,
          date: '2026-12-08',
          time: '09:00',
        });
        const suppressedId = suppressed.body.appointment.id as number;
        await backdate(suppressedId, 2);

        const before = await countMessages();
        const result = await runReminderTick(pool, logger);
        expect(result).toEqual({ processed: 1, sent: 0, failed: 0, suppressed: 1, cancelled: 0 });
        expect(await countMessages()).toBe(before);
        const rows = await reminderRows(suppressedId);
        const target = rows.find((r) => r.offset_hours === 2);
        expect(target?.status).toBe('SUPPRESSED');
        expect(target?.suppression_reason).toBe('quiet_hours');
        expect(target?.message_id).toBeNull();

        const allowed = await createAppt(ownerACookie, orgAId, {
          patientId: patientAId,
          date: '2026-12-09',
          time: '09:00',
        });
        const allowedId = allowed.body.appointment.id as number;
        await backdate(allowedId, 2);

        const outside = new Date(Date.now() + 2 * 3_600_000);
        const second = await runReminderTick(pool, logger, { now: outside });
        expect(second.sent).toBe(1);
        const allowedRows = await reminderRows(allowedId);
        expect(allowedRows.find((r) => r.offset_hours === 2)?.status).toBe('SENT');
      } finally {
        await resetReminderConfig();
      }
    });

    it('honors the patient communication preference (smsOptOut) and validates it', async () => {
      const patch = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${patientAId}`)
        .set('Cookie', ownerACookie)
        .send({ smsOptOut: true });
      expect(patch.status).toBe(200);
      expect(patch.body.patient.smsOptOut).toBe(true);

      const get = await request(app)
        .get(`/api/organizations/${orgAId}/patients/${patientAId}`)
        .set('Cookie', ownerACookie);
      expect(get.status).toBe(200);
      expect(get.body.patient.smsOptOut).toBe(true);

      const invalid = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${patientAId}`)
        .set('Cookie', ownerACookie)
        .send({ smsOptOut: 'yes' });
      expect(invalid.status).toBe(400);
      expect(JSON.stringify(invalid.body)).toContain('smsOptOut must be a boolean');

      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-12',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;
      await backdate(apptId, 24);

      const before = await countMessages();
      const result = await runReminderTick(pool, logger);
      expect(result.suppressed).toBe(1);
      expect(result.sent).toBe(0);
      expect(await countMessages()).toBe(before);
      const rows = await reminderRows(apptId);
      const target = rows.find((r) => r.offset_hours === 24);
      expect(target?.status).toBe('SUPPRESSED');
      expect(target?.suppression_reason).toBe('communication_not_permitted');

      const resume = await request(app)
        .patch(`/api/organizations/${orgAId}/patients/${patientAId}`)
        .set('Cookie', ownerACookie)
        .send({ smsOptOut: false });
      expect(resume.status).toBe(200);
      expect(resume.body.patient.smsOptOut).toBe(false);

      const second = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-13',
        time: '09:00',
      });
      const secondId = second.body.appointment.id as number;
      await backdate(secondId, 24);
      const secondResult = await runReminderTick(pool, logger);
      expect(secondResult.sent).toBe(1);
    });

    it('does not send while the reminder config is disabled and falls back on corrupt config', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-15',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;
      await backdate(apptId, 48);

      await setReminderConfig({ enabled: false });
      const result = await runReminderTick(pool, logger);
      expect(result.processed).toBe(0);
      const rows = await reminderRows(apptId);
      expect(rows.find((r) => r.offset_hours === 48)?.status).toBe('PENDING');

      await pool.query(
        `UPDATE app_meta SET meta_value = 'not-json' WHERE meta_key = ?`,
        [REMINDER_CONFIG_META_KEY],
      );
      const loaded = await loadReminderConfig(pool);
      expect(loaded).toEqual(DEFAULT_REMINDER_CONFIG);

      await resetReminderConfig();
      const recovered = await runReminderTick(pool, logger);
      expect(recovered.sent).toBe(1);
    });

    it('lazily cancels reminders when appointment status changes outside the routes', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientAId,
        date: '2026-12-18',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;
      await pool.query(`UPDATE appointments SET status = 'CANCELLED' WHERE id = ?`, [apptId]);
      await backdate(apptId, 48);

      const result = await runReminderTick(pool, logger);
      expect(result).toEqual({ processed: 1, sent: 0, failed: 0, suppressed: 0, cancelled: 1 });
      const rows = await reminderRows(apptId);
      const target = rows.find((r) => r.offset_hours === 48);
      expect(target?.status).toBe('CANCELLED');
      expect(target?.suppression_reason).toBe('appointment_inactive');
    });

    it('handles failed sends: retry with backoff, permanent stop at max attempts, recovery', async () => {
      const created = await createAppt(ownerACookie, orgAId, {
        patientId: patientFailId,
        date: '2026-12-20',
        time: '09:00',
      });
      const apptId = created.body.appointment.id as number;

      try {
        await backdate(apptId, 24);
        const first = await runReminderTick(pool, logger);
        expect(first).toEqual({ processed: 1, sent: 0, failed: 1, suppressed: 0, cancelled: 0 });

        let rows = await reminderRows(apptId);
        let target = rows.find((r) => r.offset_hours === 24);
        expect(target?.status).toBe('FAILED');
        expect(target?.attempts).toBe(1);
        expect(target?.last_error).toContain('mock_recipient_failure');
        const backoff1 = target?.scheduled_at.getTime() ?? 0;
        expect(backoff1).toBeGreaterThan(Date.now() + 45_000);
        expect(backoff1).toBeLessThan(Date.now() + 75_000);

        const mid = await runReminderTick(pool, logger);
        expect(mid.processed).toBe(0);

        await backdate(apptId, 24);
        await runReminderTick(pool, logger);
        rows = await reminderRows(apptId);
        target = rows.find((r) => r.offset_hours === 24);
        expect(target?.attempts).toBe(2);

        await backdate(apptId, 24);
        await runReminderTick(pool, logger);
        rows = await reminderRows(apptId);
        target = rows.find((r) => r.offset_hours === 24);
        expect(target?.attempts).toBe(3);
        expect(target?.status).toBe('FAILED');

        await backdate(apptId, 24);
        const stopped = await runReminderTick(pool, logger);
        expect(stopped.processed).toBe(0);

        const dueRow = (await reminderRows(apptId)).find((r) => r.offset_hours === 24);
        const msg = await messageByKey(`reminder:${dueRow?.id ?? 0}`);
        expect(msg?.status).toBe('FAILED');
        expect(msg?.recipient).toBe('999999999');

        const healthy = await createAppt(ownerACookie, orgAId, {
          patientId: patientFailId,
          date: '2026-12-21',
          time: '09:00',
        });
        const healthyId = healthy.body.appointment.id as number;
        await backdate(healthyId, 24);
        const failedOnce = await runReminderTick(pool, logger);
        expect(failedOnce.failed).toBe(1);
        const healthyRows = await reminderRows(healthyId);
        expect(healthyRows.find((r) => r.offset_hours === 24)?.status).toBe('FAILED');
        expect(healthyRows.find((r) => r.offset_hours === 24)?.attempts).toBe(1);

        registerProvider(new MockProvider({ failOn: [] }));
        await backdate(healthyId, 24);
        const recovered = await runReminderTick(pool, logger);
        expect(recovered.sent).toBe(1);
        const recoveredRows = await reminderRows(healthyId);
        expect(recoveredRows.find((r) => r.offset_hours === 24)?.status).toBe('SENT');

        await backdate(apptId, 24);
        const stillDead = await runReminderTick(pool, logger);
        expect(stillDead.processed).toBe(0);
      } finally {
        registerProvider(new MockProvider());
      }
    });

    it('never throws for unknown appointment ids', async () => {
      const schedule = await scheduleRemindersForAppointment(pool, logger, 999_999_999);
      expect(schedule).toEqual({ scheduled: 0, skipped: 0 });
      const cancel = await cancelRemindersForAppointment(
        pool,
        logger,
        999_999_999,
        'appointment_cancelled',
      );
      expect(cancel).toEqual({ cancelled: 0 });
    });
  },
);
