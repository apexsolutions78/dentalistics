import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeNoShowCase,
  runNoShowTick,
  startNoShowRecovery,
} from '../src/automation/noShow';
import {
  DEFAULT_NO_SHOW_CONFIG,
  NO_SHOW_CONFIG_META_KEY,
  loadNoShowConfig,
} from '../src/automation/noShowConfig';
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

interface CaseRow extends mysql.RowDataPacket {
  id: number;
  appointment_id: number;
  patient_id: number;
  status: string;
  rebooked_appointment_id: number | null;
  close_reason: string | null;
  opened_at: Date;
  closed_at: Date | null;
}

interface NoShowMessageRow extends mysql.RowDataPacket {
  id: number;
  case_id: number;
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

interface ReminderRow extends mysql.RowDataPacket {
  offset_hours: number;
  status: string;
  suppression_reason: string | null;
}

describe.skipIf(testHost === undefined || testHost === '')(
  'M9 acceptance: no-show recovery',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgId: number;
    const ownerEmail = 'owner.m9@apextest.local';
    const ownerPassword = 'OwnerM9Passw0rd!26x';
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

    async function freshPatient(
      first: string,
      phone?: string,
    ): Promise<number> {
      phoneSeq += 1;
      const res = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: first,
          lastName: 'M9',
          phone: phone ?? `15550309${String(phoneSeq).padStart(4, '0')}`,
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

    async function markNoShow(appointmentId: number): Promise<request.Response> {
      return request(app)
        .post(appointmentPath(appointmentId, 'no-show'))
        .set('Cookie', ownerCookie)
        .send({});
    }

    async function caseRows(appointmentId: number): Promise<CaseRow[]> {
      const [rows] = await pool.query<CaseRow[]>(
        `SELECT id, appointment_id, patient_id, status, rebooked_appointment_id,
           close_reason, opened_at, closed_at
         FROM no_show_cases WHERE appointment_id = ?`,
        [appointmentId],
      );
      return rows;
    }

    async function noShowMessageRows(caseId: number): Promise<NoShowMessageRow[]> {
      const [rows] = await pool.query<NoShowMessageRow[]>(
        `SELECT id, case_id, phase, status, scheduled_at, sent_at, message_id,
           attempts, last_error, suppression_reason
         FROM no_show_messages WHERE case_id = ? ORDER BY phase`,
        [caseId],
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

    async function commCountForCase(caseId: number): Promise<number> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM communication_messages
         WHERE idempotency_key IN (
           SELECT CONCAT('noshow:', id) FROM no_show_messages WHERE case_id = ?
         )`,
        [caseId],
      );
      return rows[0]?.total ?? 0;
    }

    async function reminderRows(appointmentId: number): Promise<ReminderRow[]> {
      const [rows] = await pool.query<ReminderRow[]>(
        `SELECT offset_hours, status, suppression_reason
         FROM appointment_reminders WHERE appointment_id = ?`,
        [appointmentId],
      );
      return rows;
    }

    async function setNoShowConfig(patch: Record<string, unknown>): Promise<void> {
      const current = await loadNoShowConfig(pool);
      const merged: Record<string, unknown> = {
        ...current,
        ...patch,
        templates: { ...current.templates, ...((patch.templates as object) ?? {}) },
      };
      await pool.query(
        `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [NO_SHOW_CONFIG_META_KEY, JSON.stringify(merged)],
      );
    }

    async function resetNoShowConfig(): Promise<void> {
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [NO_SHOW_CONFIG_META_KEY]);
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
      await resetNoShowConfig();
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['reminder_config']);

      orgId = await insertOrg('M9 Clinic');
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

    it('starts recovery on no-show: case, immediate message, scheduled follow-up', async () => {
      const patientId = await freshPatient('Alice');
      const created = await createAppt(patientId, {
        date: '2026-10-10',
        time: '10:00',
        service: 'Check-up',
      });
      expect(created.status).toBe(201);
      const apptId = created.body.appointment.id as number;

      const before = Date.now();
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);
      expect(res.body.appointment.status).toBe('NO_SHOW');

      const cases = await caseRows(apptId);
      expect(cases).toHaveLength(1);
      const caseId = cases[0]?.id ?? 0;
      expect(cases[0]?.status).toBe('OPEN');
      expect(cases[0]?.patient_id).toBe(patientId);
      expect(cases[0]?.opened_at.getTime()).toBeGreaterThanOrEqual(before - 2000);
      expect(cases[0]?.closed_at).toBeNull();

      const rows = await noShowMessageRows(caseId);
      expect(rows.map((r) => r.phase)).toEqual(['INITIAL', 'FOLLOW_UP']);
      const initial = rows.find((r) => r.phase === 'INITIAL');
      expect(initial?.status).toBe('SENT');
      expect(initial?.message_id).not.toBeNull();
      expect(initial?.attempts).toBe(1);
      expect(initial?.sent_at).not.toBeNull();

      const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
      expect(followUp?.status).toBe('PENDING');
      expect(followUp?.message_id).toBeNull();
      const expectedFollowUp = before + 24 * HOUR;
      expect(followUp?.scheduled_at.getTime() ?? 0).toBeGreaterThanOrEqual(expectedFollowUp - 300_000);
      expect(followUp?.scheduled_at.getTime() ?? 0).toBeLessThanOrEqual(Date.now() + 24 * HOUR + 300_000);

      const msg = await messageByKey(`noshow:${initial?.id ?? 0}`);
      expect(msg).not.toBeNull();
      expect(msg?.status).toBe('SENT');
      expect(msg?.message_type).toBe('no_show_message');
      expect(msg?.template).toBe('no_show_message');
      expect(msg?.body).toContain('Alice');
      expect(msg?.body).toContain('2026-10-10');
      expect(msg?.body).not.toContain('{{');
      expect(await commCountForCase(caseId)).toBe(1);

      const reminders = await reminderRows(apptId);
      expect(reminders).toHaveLength(3);
      expect(reminders.every((r) => r.status === 'CANCELLED')).toBe(true);
      expect(
        reminders.every((r) => r.suppression_reason === 'appointment_no_show'),
      ).toBe(true);
    });

    it('sends the follow-up after the configured delay, exactly once', async () => {
      const patientId = await freshPatient('Bob');
      const created = await createAppt(patientId, { date: '2026-09-21', time: '11:00' });
      const apptId = created.body.appointment.id as number;
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);

      const cases = await caseRows(apptId);
      const caseId = cases[0]?.id ?? 0;
      const rows = await noShowMessageRows(caseId);
      const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
      const key = `noshow:${followUp?.id ?? 0}`;

      const tick = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 25 * HOUR),
      });
      expect(tick.sent).toBeGreaterThanOrEqual(1);
      expect(tick.failed).toBe(0);
      expect(tick.cancelled).toBe(0);

      const after = await noShowMessageRows(caseId);
      const sentFollowUp = after.find((r) => r.phase === 'FOLLOW_UP');
      expect(sentFollowUp?.status).toBe('SENT');
      expect(sentFollowUp?.attempts).toBe(1);
      expect(sentFollowUp?.message_id).not.toBeNull();
      expect(sentFollowUp?.sent_at).not.toBeNull();

      const msg = await messageByKey(key);
      expect(msg?.status).toBe('SENT');
      expect(msg?.message_type).toBe('no_show_follow_up');
      expect(msg?.template).toBe('no_show_follow_up');
      expect(msg?.body).toContain('Bob');
      expect(msg?.body).not.toContain('{{');
      expect(await commCountForCase(caseId)).toBe(2);

      const second = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 25 * HOUR),
      });
      expect(second.processed).toBe(0);
      expect(await commCountForCase(caseId)).toBe(2);
      expect((await caseRows(apptId))[0]?.status).toBe('OPEN');
    });

    it('keeps the case open with no further messages when the patient never responds', async () => {
      const patientId = await freshPatient('Carol');
      const created = await createAppt(patientId, { date: '2026-09-22', time: '09:30' });
      const apptId = created.body.appointment.id as number;
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);
      const caseId = (await caseRows(apptId))[0]?.id ?? 0;

      await runNoShowTick(pool, logger, { now: new Date(Date.now() + 25 * HOUR) });
      const later = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 48 * HOUR),
      });
      expect(later.processed).toBe(0);

      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('OPEN');
      expect(cases[0]?.closed_at).toBeNull();
      const rows = await noShowMessageRows(caseId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status !== 'PENDING' && r.status !== 'SENDING')).toBe(true);
      expect(await commCountForCase(caseId)).toBe(2);
    });

    it('rebook endpoint closes the recovery as rebooked and stops automation', async () => {
      const patientId = await freshPatient('Dave');
      const created = await createAppt(patientId, { date: '2026-09-23', time: '14:00' });
      const apptId = created.body.appointment.id as number;
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);
      const caseId = (await caseRows(apptId))[0]?.id ?? 0;

      const rebook = await request(app)
        .post(appointmentPath(apptId, 'rebook'))
        .set('Cookie', ownerCookie)
        .send({ date: '2026-10-15', time: '14:00' });
      expect(rebook.status).toBe(200);
      const newId = rebook.body.appointment.id as number;

      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('REBOOKED');
      expect(cases[0]?.rebooked_appointment_id).toBe(newId);
      expect(cases[0]?.close_reason).toBe('rebooked');
      expect(cases[0]?.closed_at).not.toBeNull();

      const rows = await noShowMessageRows(caseId);
      const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
      expect(followUp?.status).toBe('CANCELLED');
      expect(followUp?.suppression_reason).toBe('rebooked');

      const tick = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 25 * HOUR),
      });
      expect(tick).toEqual({
        processed: 0,
        sent: 0,
        failed: 0,
        suppressed: 0,
        cancelled: 0,
        rebooked: 0,
      });
      expect(await commCountForCase(caseId)).toBe(1);
    });

    it('lazily detects staff rebooking through a plain new appointment', async () => {
      const patientId = await freshPatient('Emma');
      const created = await createAppt(patientId, { date: '2026-09-24', time: '15:30' });
      const apptId = created.body.appointment.id as number;
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);
      const caseId = (await caseRows(apptId))[0]?.id ?? 0;

      const replacement = await createAppt(patientId, {
        date: '2026-10-20',
        time: '10:00',
      });
      expect(replacement.status).toBe(201);
      const replacementId = replacement.body.appointment.id as number;

      const tick = await runNoShowTick(pool, logger);
      expect(tick.rebooked).toBe(1);

      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('REBOOKED');
      expect(cases[0]?.rebooked_appointment_id).toBe(replacementId);
      const followUp = (await noShowMessageRows(caseId)).find((r) => r.phase === 'FOLLOW_UP');
      expect(followUp?.status).toBe('CANCELLED');
      expect(followUp?.suppression_reason).toBe('rebooked');
      expect(await commCountForCase(caseId)).toBe(1);
    });

    it('manual closure stops the automation and cannot be repeated', async () => {
      const patientId = await freshPatient('Frank');
      const created = await createAppt(patientId, { date: '2026-09-25', time: '08:45' });
      const apptId = created.body.appointment.id as number;
      const res = await markNoShow(apptId);
      expect(res.status).toBe(200);
      const caseId = (await caseRows(apptId))[0]?.id ?? 0;

      const close = await request(app)
        .post(appointmentPath(apptId, 'noshow/close'))
        .set('Cookie', ownerCookie)
        .send({ reason: 'Patient called to rebook' });
      expect(close.status).toBe(200);
      expect(close.body.case.status).toBe('CLOSED');
      expect(close.body.case.closeReason).toBe('Patient called to rebook');

      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('CLOSED');
      expect(cases[0]?.close_reason).toBe('Patient called to rebook');
      expect(cases[0]?.rebooked_appointment_id).toBeNull();

      const followUp = (await noShowMessageRows(caseId)).find((r) => r.phase === 'FOLLOW_UP');
      expect(followUp?.status).toBe('CANCELLED');
      expect(followUp?.suppression_reason).toBe('Patient called to rebook');

      const tick = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 25 * HOUR),
      });
      expect(tick.processed).toBe(0);
      expect(await commCountForCase(caseId)).toBe(1);

      const again = await request(app)
        .post(appointmentPath(apptId, 'noshow/close'))
        .set('Cookie', ownerCookie)
        .send({});
      expect(again.status).toBe(404);
    });

    it('duplicate no-show events do not duplicate the recovery', async () => {
      const patientId = await freshPatient('Grace');
      const created = await createAppt(patientId, { date: '2026-09-26', time: '13:15' });
      const apptId = created.body.appointment.id as number;

      const first = await markNoShow(apptId);
      expect(first.status).toBe(200);

      const second = await markNoShow(apptId);
      expect(second.status).toBe(409);

      const started = await startNoShowRecovery(pool, logger, { appointmentId: apptId });
      expect(started.started).toBe(false);
      expect(started.reason).toBe('already_started');

      const cases = await caseRows(apptId);
      expect(cases).toHaveLength(1);
      const caseId = cases[0]?.id ?? 0;
      const rows = await noShowMessageRows(caseId);
      expect(rows).toHaveLength(2);
      expect(await commCountForCase(caseId)).toBe(1);
    });

    it('cancelling an appointment starts no recovery and closed cases stay closed', async () => {
      const cancelPatient = await freshPatient('Helen');
      const cancelCreated = await createAppt(cancelPatient, {
        date: '2026-10-01',
        time: '09:00',
      });
      const cancelApptId = cancelCreated.body.appointment.id as number;
      const cancelRes = await request(app)
        .post(appointmentPath(cancelApptId, 'cancel'))
        .set('Cookie', ownerCookie)
        .send({});
      expect(cancelRes.status).toBe(200);
      expect(await caseRows(cancelApptId)).toHaveLength(0);

      const patientId = await freshPatient('Ivan');
      const created = await createAppt(patientId, { date: '2026-09-19', time: '16:00' });
      const apptId = created.body.appointment.id as number;
      expect((await markNoShow(apptId)).status).toBe(200);
      const caseId = (await caseRows(apptId))[0]?.id ?? 0;

      const rebook = await request(app)
        .post(appointmentPath(apptId, 'rebook'))
        .set('Cookie', ownerCookie)
        .send({ date: '2026-10-18', time: '11:00' });
      expect(rebook.status).toBe(200);
      const newId = rebook.body.appointment.id as number;
      expect((await caseRows(apptId))[0]?.status).toBe('REBOOKED');

      const cancelNew = await request(app)
        .post(appointmentPath(newId, 'cancel'))
        .set('Cookie', ownerCookie)
        .send({});
      expect(cancelNew.status).toBe(200);

      const tick = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 30 * HOUR),
      });
      expect(tick.rebooked).toBe(0);
      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('REBOOKED');
      expect(cases[0]?.rebooked_appointment_id).toBe(newId);
      expect(await commCountForCase(caseId)).toBe(1);
    });

    it('suppresses recovery messages for opted-out patients', async () => {
      const patientId = await freshPatient('Julia');
      const patch = await request(app)
        .patch(`/api/organizations/${orgId}/patients/${patientId}`)
        .set('Cookie', ownerCookie)
        .send({ smsOptOut: true });
      expect(patch.status).toBe(200);

      const created = await createAppt(patientId, { date: '2026-09-18', time: '10:30' });
      const apptId = created.body.appointment.id as number;
      expect((await markNoShow(apptId)).status).toBe(200);

      const cases = await caseRows(apptId);
      expect(cases[0]?.status).toBe('OPEN');
      const caseId = cases[0]?.id ?? 0;

      let rows = await noShowMessageRows(caseId);
      const initial = rows.find((r) => r.phase === 'INITIAL');
      expect(initial?.status).toBe('SUPPRESSED');
      expect(initial?.suppression_reason).toBe('communication_not_permitted');
      expect(initial?.message_id).toBeNull();
      expect(await commCountForCase(caseId)).toBe(0);

      const tick = await runNoShowTick(pool, logger, {
        now: new Date(Date.now() + 25 * HOUR),
      });
      expect(tick.suppressed).toBe(1);
      rows = await noShowMessageRows(caseId);
      const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
      expect(followUp?.status).toBe('SUPPRESSED');
      expect(followUp?.suppression_reason).toBe('communication_not_permitted');
      expect(await commCountForCase(caseId)).toBe(0);
      expect((await caseRows(apptId))[0]?.status).toBe('OPEN');
    });

    it('does not start recovery while the config is disabled', async () => {
      const patientId = await freshPatient('Karen');
      const created = await createAppt(patientId, { date: '2026-09-17', time: '12:00' });
      const apptId = created.body.appointment.id as number;
      try {
        await setNoShowConfig({ enabled: false });
        expect((await markNoShow(apptId)).status).toBe(200);
        expect(await caseRows(apptId)).toHaveLength(0);

        const tick = await runNoShowTick(pool, logger);
        expect(tick).toEqual({
          processed: 0,
          sent: 0,
          failed: 0,
          suppressed: 0,
          cancelled: 0,
          rebooked: 0,
        });
      } finally {
        await resetNoShowConfig();
      }
    });

    it('falls back to defaults on corrupt config', async () => {
      try {
        await pool.query(
          `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, 'not-json')
           ON DUPLICATE KEY UPDATE meta_value = 'not-json'`,
          [NO_SHOW_CONFIG_META_KEY],
        );
        const loaded = await loadNoShowConfig(pool);
        expect(loaded).toEqual(DEFAULT_NO_SHOW_CONFIG);
      } finally {
        await resetNoShowConfig();
      }
    });

    it('honors a custom follow-up delay and templates with missing variables', async () => {
      const patientId = await freshPatient('Liam');
      const created = await createAppt(patientId, { date: '2026-09-16', time: '17:45' });
      const apptId = created.body.appointment.id as number;
      const customFollowUp =
        'CUSTOM {{first_name}} [{{booking_link}}|{{clinic_phone}}].';
      try {
        await setNoShowConfig({
          followUpDelayHours: 2,
          templates: { followUp: customFollowUp },
        });
        const before = Date.now();
        expect((await markNoShow(apptId)).status).toBe(200);
        const caseId = (await caseRows(apptId))[0]?.id ?? 0;

        const rows = await noShowMessageRows(caseId);
        const followUp = rows.find((r) => r.phase === 'FOLLOW_UP');
        const expected = before + 2 * HOUR;
        expect(followUp?.scheduled_at.getTime() ?? 0).toBeGreaterThanOrEqual(expected - 300_000);
        expect(followUp?.scheduled_at.getTime() ?? 0).toBeLessThanOrEqual(
          Date.now() + 2 * HOUR + 300_000,
        );

        const tick = await runNoShowTick(pool, logger, {
          now: new Date(Date.now() + 3 * HOUR),
        });
        expect(tick.sent).toBe(1);
        const msg = await messageByKey(`noshow:${followUp?.id ?? 0}`);
        expect(msg?.body).toBe('CUSTOM Liam [|].');
        expect(msg?.body).not.toContain('{{');
      } finally {
        await resetNoShowConfig();
      }
    });

    it('backs off failed sends and stops at max attempts', async () => {
      const patientId = await freshPatient('Fred', '999999999');
      const created = await createAppt(patientId, { date: '2026-09-15', time: '08:00' });
      const apptId = created.body.appointment.id as number;
      const t0 = Date.now();
      expect((await markNoShow(apptId)).status).toBe(200);

      const caseId = (await caseRows(apptId))[0]?.id ?? 0;
      let rows = await noShowMessageRows(caseId);
      const initial = rows.find((r) => r.phase === 'INITIAL');
      expect(initial?.status).toBe('FAILED');
      expect(initial?.attempts).toBe(1);
      expect(initial?.last_error).toContain('mock_recipient_failure');
      expect(initial?.message_id).not.toBeNull();
      const backoff1 = initial?.scheduled_at.getTime() ?? 0;
      expect(backoff1).toBeGreaterThan(t0 + 45_000);
      expect(backoff1).toBeLessThan(t0 + 75_000);

      const beforeBackoff = await runNoShowTick(pool, logger, {
        now: new Date(t0 + 1_000),
      });
      expect(beforeBackoff.processed).toBe(0);

      const second = await runNoShowTick(pool, logger, { now: new Date(t0 + 70_000) });
      expect(second.failed).toBe(1);
      rows = await noShowMessageRows(caseId);
      expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(2);

      const third = await runNoShowTick(pool, logger, { now: new Date(t0 + 200_000) });
      expect(third.failed).toBe(1);
      rows = await noShowMessageRows(caseId);
      expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(3);
      expect(rows.find((r) => r.phase === 'INITIAL')?.status).toBe('FAILED');

      const stopped = await runNoShowTick(pool, logger, { now: new Date(t0 + 600_000) });
      expect(stopped.processed).toBe(0);
      rows = await noShowMessageRows(caseId);
      expect(rows.find((r) => r.phase === 'INITIAL')?.attempts).toBe(3);

      const msg = await messageByKey(`noshow:${initial?.id ?? 0}`);
      expect(msg?.status).toBe('FAILED');
      expect(msg?.recipient).toBe('999999999');
      expect((await caseRows(apptId))[0]?.status).toBe('OPEN');
    });

    it('handles unknown appointment ids without throwing', async () => {
      const started = await startNoShowRecovery(pool, logger, {
        appointmentId: 999_999_999,
      });
      expect(started).toEqual({
        started: false,
        caseId: null,
        reason: 'appointment_not_no_show',
      });
      const closed = await closeNoShowCase(pool, logger, {
        appointmentId: 999_999_999,
        reason: 'staff_closed',
      });
      expect(closed).toEqual({ closed: false, caseId: null, status: null });

      const routeClose = await request(app)
        .post(appointmentPath(999_999_999, 'noshow/close'))
        .set('Cookie', ownerCookie)
        .send({});
      expect(routeClose.status).toBe(404);
    });
  },
);
