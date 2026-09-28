import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createReviewRequestForCompletedAppointment,
  runReviewRequestTick,
} from '../src/automation/reviewRequests';
import {
  DEFAULT_REVIEW_CONFIG,
  REVIEW_CONFIG_META_KEY,
  loadReviewConfig,
} from '../src/automation/reviewConfig';
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

interface ReviewRow extends mysql.RowDataPacket {
  id: number;
  organization_id: number;
  patient_id: number;
  appointment_id: number;
  status: string;
  scheduled_at: Date;
  sent_at: Date | null;
  message_id: number | null;
  attempts: number;
  last_error: string | null;
  suppression_reason: string | null;
  review_url: string | null;
  created_at: Date;
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

describe.skipIf(testHost === undefined || testHost === '')(
  'M11 acceptance: review requests',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgId: number;
    const ownerEmail = 'owner.m11@apextest.local';
    const ownerPassword = 'OwnerM11Passw0rd!26x';
    const recEmail = 'rec.m11@apextest.local';
    const recPassword = 'RecM11Passw0rd!26x';
    let ownerCookie: string;
    let recCookie: string;
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
          lastName: 'M11',
          phone: phone ?? `15550411${String(phoneSeq).padStart(4, '0')}`,
        });
      expect(res.status).toBe(201);
      return res.body.patient.id as number;
    }

    function createAppt(patientId: number, body: Record<string, unknown>): request.Test {
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

    function patchOrg(
      targetOrg: number,
      body: Record<string, unknown>,
      as: string = ownerCookie,
    ): request.Test {
      return request(app)
        .patch(`/api/organizations/${targetOrg}`)
        .set('Cookie', as)
        .send(body);
    }

    async function setReviewUrl(url: string | null): Promise<void> {
      const res = await patchOrg(orgId, { reviewUrl: url });
      expect(res.status).toBe(200);
      expect(res.body.organization.reviewUrl).toBe(url);
    }

    async function reviewRowsForPatient(patientId: number): Promise<ReviewRow[]> {
      const [rows] = await pool.query<ReviewRow[]>(
        `SELECT id, organization_id, patient_id, appointment_id, status, scheduled_at,
           sent_at, message_id, attempts, last_error, suppression_reason, review_url, created_at
         FROM review_requests WHERE patient_id = ? ORDER BY id ASC`,
        [patientId],
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

    async function commCountForReview(reviewId: number): Promise<number> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM communication_messages WHERE idempotency_key = ?',
        [`review:${reviewId}`],
      );
      return rows[0]?.total ?? 0;
    }

    async function setReviewConfig(patch: Record<string, unknown>): Promise<void> {
      const current = await loadReviewConfig(pool);
      const merged: Record<string, unknown> = { ...current, ...patch };
      await pool.query(
        `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [REVIEW_CONFIG_META_KEY, JSON.stringify(merged)],
      );
    }

    async function resetReviewConfig(): Promise<void> {
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [REVIEW_CONFIG_META_KEY]);
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
      await resetReviewConfig();
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['recall_config']);
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['noshow_config']);
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', ['reminder_config']);

      orgId = await insertOrg('M11 Clinic');
      await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
      await insertUser(orgId, recEmail, recPassword, 'receptionist');

      logger = captureLogger();
      app = createApp({ db: pool, logger });
      ownerCookie = await login(ownerEmail, ownerPassword);
      recCookie = await login(recEmail, recPassword);
    }, 30_000);

    afterAll(async () => {
      registerProvider(new MockProvider());
      if (pool !== undefined) {
        await pool.end();
      }
    });

    it('runs the TEST 10 flow: eligible completion sends one review request with audit fields', async () => {
      await setReviewUrl('https://reviews.example.com/m11-clinic');
      const patientId = await freshPatient('Alice');
      try {
        await setReviewConfig({ delayHours: 0 });

        const eligibility = await createAppt(patientId, {
          date: utcDay(1),
          time: '09:00',
          service: 'Check-up',
        });
        const scheduledId = eligibility.body.appointment.id as number;
        const notCompleted = await createReviewRequestForCompletedAppointment(pool, logger, {
          appointmentId: scheduledId,
        });
        expect(notCompleted).toEqual({
          created: false,
          reviewRequestId: null,
          status: null,
          reason: 'appointment_not_completed',
        });

        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '10:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);

        const rows = await reviewRowsForPatient(patientId);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row?.status).toBe('SENT');
        expect(row?.organization_id).toBe(orgId);
        expect(row?.appointment_id).toBe(apptId);
        expect(row?.review_url).toBe('https://reviews.example.com/m11-clinic');
        expect(row?.suppression_reason).toBeNull();
        expect(row?.created_at).not.toBeNull();
        expect(row?.scheduled_at).not.toBeNull();
        expect(row?.sent_at).not.toBeNull();
        expect(row?.message_id).not.toBeNull();
        expect(row?.attempts).toBeGreaterThanOrEqual(1);

        const msg = await messageByKey(`review:${row?.id ?? 0}`);
        expect(msg?.status).toBe('SENT');
        expect(msg?.message_type).toBe('review_request');
        expect(msg?.body).toContain('Alice');
        expect(msg?.body).toContain('M11 Clinic');
        expect(msg?.body).toContain('https://reviews.example.com/m11-clinic');
        expect(msg?.body).not.toContain('{{');
        expect(await commCountForReview(row?.id ?? 0)).toBe(1);

        const again = await createReviewRequestForCompletedAppointment(pool, logger, {
          appointmentId: apptId,
        });
        expect(again.created).toBe(false);
        expect(again.reason).toBe('already_exists');
        expect(again.reviewRequestId).toBe(row?.id ?? null);
        expect(await reviewRowsForPatient(patientId)).toHaveLength(1);
      } finally {
        await resetReviewConfig();
      }
    });

    it('waits the configured delay, then sends exactly when due', async () => {
      const patientId = await freshPatient('Bob');
      try {
        await setReviewConfig({ delayHours: 1 });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '11:00',
          service: 'Cleaning',
        });
        const apptId = created.body.appointment.id as number;
        const t0 = Date.now();
        expect((await completeApp(apptId)).status).toBe(200);

        const rows = await reviewRowsForPatient(patientId);
        expect(rows).toHaveLength(1);
        const reviewId = rows[0]?.id ?? 0;
        expect(rows[0]?.status).toBe('PENDING');
        expect(rows[0]?.sent_at).toBeNull();
        const scheduled = rows[0]?.scheduled_at.getTime() ?? 0;
        expect(scheduled).toBeGreaterThan(t0 + 59 * MINUTE);
        expect(scheduled).toBeLessThan(t0 + 61 * MINUTE);

        const before = await runReviewRequestTick(pool, logger, {
          now: new Date(scheduled - MINUTE),
        });
        expect(before.processed).toBe(0);
        expect((await reviewRowsForPatient(patientId))[0]?.status).toBe('PENDING');

        const due = await runReviewRequestTick(pool, logger, {
          now: new Date(scheduled + MINUTE),
        });
        expect(due.sent).toBeGreaterThanOrEqual(1);
        const after = await reviewRowsForPatient(patientId);
        expect(after[0]?.status).toBe('SENT');
        expect(after[0]?.sent_at).not.toBeNull();
        expect(await commCountForReview(reviewId)).toBe(1);
      } finally {
        await resetReviewConfig();
      }
    });

    it('prevents duplicates: same appointment idempotent, patient suppressed within window, allowed after', async () => {
      const patientId = await freshPatient('Cara');
      try {
        await setReviewConfig({ delayHours: 0, suppressionPeriodDays: 1 });

        const first = await createAppt(patientId, {
          date: utcDay(-2),
          time: '09:00',
          service: 'Check-up',
        });
        const firstId = first.body.appointment.id as number;
        expect((await completeApp(firstId)).status).toBe(200);
        const rows1 = await reviewRowsForPatient(patientId);
        expect(rows1).toHaveLength(1);
        expect(rows1[0]?.status).toBe('SENT');

        const second = await createAppt(patientId, {
          date: utcDay(-1),
          time: '09:30',
          service: 'Check-up',
        });
        const secondId = second.body.appointment.id as number;
        expect((await completeApp(secondId)).status).toBe(200);
        const rows2 = await reviewRowsForPatient(patientId);
        expect(rows2).toHaveLength(2);
        expect(rows2[1]?.status).toBe('SUPPRESSED');
        expect(rows2[1]?.suppression_reason).toBe('within_suppression_period');
        expect(rows2[1]?.sent_at).toBeNull();
        expect(await commCountForReview(rows2[1]?.id ?? 0)).toBe(0);

        await pool.query(
          'UPDATE review_requests SET created_at = DATE_SUB(created_at, INTERVAL 3 DAY) WHERE id = ?',
          [rows1[0]?.id ?? 0],
        );

        const third = await createAppt(patientId, {
          date: utcDay(-1),
          time: '14:00',
          service: 'Cleaning',
        });
        const thirdId = third.body.appointment.id as number;
        expect((await completeApp(thirdId)).status).toBe(200);
        const rows3 = await reviewRowsForPatient(patientId);
        expect(rows3).toHaveLength(3);
        expect(rows3[2]?.status).toBe('SENT');
        expect(await commCountForReview(rows3[2]?.id ?? 0)).toBe(1);
      } finally {
        await resetReviewConfig();
      }
    });

    it('respects communication preferences: opt-out suppresses, opt-in resumes', async () => {
      const patientId = await freshPatient('Dana');
      try {
        await setReviewConfig({ delayHours: 0 });
        const patch = await request(app)
          .patch(`/api/organizations/${orgId}/patients/${patientId}`)
          .set('Cookie', ownerCookie)
          .send({ smsOptOut: true });
        expect(patch.status).toBe(200);

        const first = await createAppt(patientId, {
          date: utcDay(-1),
          time: '12:00',
          service: 'Check-up',
        });
        const firstId = first.body.appointment.id as number;
        expect((await completeApp(firstId)).status).toBe(200);

        let rows = await reviewRowsForPatient(patientId);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe('SUPPRESSED');
        expect(rows[0]?.suppression_reason).toBe('communication_not_permitted');
        expect(rows[0]?.sent_at).toBeNull();
        expect(await commCountForReview(rows[0]?.id ?? 0)).toBe(0);

        const back = await request(app)
          .patch(`/api/organizations/${orgId}/patients/${patientId}`)
          .set('Cookie', ownerCookie)
          .send({ smsOptOut: false });
        expect(back.status).toBe(200);

        const second = await createAppt(patientId, {
          date: utcDay(-1),
          time: '15:00',
          service: 'Check-up',
        });
        const secondId = second.body.appointment.id as number;
        expect((await completeApp(secondId)).status).toBe(200);
        rows = await reviewRowsForPatient(patientId);
        expect(rows).toHaveLength(2);
        expect(rows[1]?.status).toBe('SENT');
        expect(await commCountForReview(rows[1]?.id ?? 0)).toBe(1);
      } finally {
        await resetReviewConfig();
      }
    });

    it('creates nothing while the config is disabled', async () => {
      const patientId = await freshPatient('Evan');
      try {
        await setReviewConfig({ enabled: false });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '08:30',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);
        expect(await reviewRowsForPatient(patientId)).toHaveLength(0);

        const tick = await runReviewRequestTick(pool, logger);
        expect(tick).toEqual({
          processed: 0,
          sent: 0,
          failed: 0,
          suppressed: 0,
          cancelled: 0,
        });
      } finally {
        await resetReviewConfig();
      }
    });

    it('falls back to defaults on corrupt config', async () => {
      try {
        await pool.query(
          `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, 'not-json')
           ON DUPLICATE KEY UPDATE meta_value = 'not-json'`,
          [REVIEW_CONFIG_META_KEY],
        );
        const loaded = await loadReviewConfig(pool);
        expect(loaded).toEqual(DEFAULT_REVIEW_CONFIG);
      } finally {
        await resetReviewConfig();
      }
    });

    it('validates the clinic-specific review URL and enforces roles/tenancy', async () => {
      const valid = 'https://maps.example.com/m11-reviews';
      const ok = await patchOrg(orgId, { reviewUrl: valid });
      expect(ok.status).toBe(200);
      expect(ok.body.organization.reviewUrl).toBe(valid);
      const got = await request(app)
        .get(`/api/organizations/${orgId}`)
        .set('Cookie', ownerCookie);
      expect(got.status).toBe(200);
      expect(got.body.organization.reviewUrl).toBe(valid);

      const badRelative = await patchOrg(orgId, { reviewUrl: 'not-a-url' });
      expect(badRelative.status).toBe(400);
      const badScheme = await patchOrg(orgId, { reviewUrl: 'ftp://example.com/reviews' });
      expect(badScheme.status).toBe(400);
      const tooLong = await patchOrg(orgId, { reviewUrl: `https://example.com/${'a'.repeat(600)}` });
      expect(tooLong.status).toBe(400);

      const byReceptionist = await patchOrg(orgId, { reviewUrl: valid }, recCookie);
      expect(byReceptionist.status).toBe(403);

      const otherOrg = await insertOrg('M11 Other Clinic');
      const cross = await patchOrg(otherOrg, { reviewUrl: valid });
      expect(cross.status).toBe(404);
      const unknownOrg = await patchOrg(999_999, { reviewUrl: valid });
      expect(unknownOrg.status).toBe(404);

      const cleared = await patchOrg(orgId, { reviewUrl: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.organization.reviewUrl).toBeNull();

      const patientId = await freshPatient('Farah');
      const created = await createAppt(patientId, {
        date: utcDay(-1),
        time: '16:00',
        service: 'Check-up',
      });
      const apptId = created.body.appointment.id as number;
      expect((await completeApp(apptId)).status).toBe(200);
      expect(await reviewRowsForPatient(patientId)).toHaveLength(0);
      const direct = await createReviewRequestForCompletedAppointment(pool, logger, {
        appointmentId: apptId,
      });
      expect(direct).toEqual({
        created: false,
        reviewRequestId: null,
        status: null,
        reason: 'review_url_missing',
      });
    });

    it('records full request history for audit', async () => {
      await setReviewUrl('https://reviews.example.com/m11-audit');
      const patientId = await freshPatient('Grace');
      try {
        await setReviewConfig({ delayHours: 0 });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '10:15',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        expect((await completeApp(apptId)).status).toBe(200);

        const rows = await reviewRowsForPatient(patientId);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row?.status).toBe('SENT');
        expect(row?.created_at).toBeInstanceOf(Date);
        expect(row?.scheduled_at).toBeInstanceOf(Date);
        expect(row?.sent_at).toBeInstanceOf(Date);
        expect(row?.message_id).not.toBeNull();
        expect(row?.review_url).toBe('https://reviews.example.com/m11-audit');
        expect(row?.attempts).toBeGreaterThanOrEqual(1);
        expect(row?.last_error).toBeNull();

        const msg = await messageByKey(`review:${row?.id ?? 0}`);
        expect(msg?.template).toBe('review_request');
        expect(msg?.body).toContain('https://reviews.example.com/m11-audit');
      } finally {
        await resetReviewConfig();
      }
    });

    it('backs off failed sends and stops at max attempts', async () => {
      await setReviewUrl('https://reviews.example.com/m11-backoff');
      const patientId = await freshPatient('Fred', '999999999');
      try {
        await setReviewConfig({ delayHours: 0 });
        const created = await createAppt(patientId, {
          date: utcDay(-1),
          time: '08:00',
          service: 'Check-up',
        });
        const apptId = created.body.appointment.id as number;
        const t0 = Date.now();
        expect((await completeApp(apptId)).status).toBe(200);

        const reviewId = (await reviewRowsForPatient(patientId))[0]?.id ?? 0;
        let row = (await reviewRowsForPatient(patientId))[0];
        expect(row?.status).toBe('FAILED');
        expect(row?.attempts).toBe(1);
        expect(row?.last_error).toContain('mock_recipient_failure');
        expect(row?.message_id).not.toBeNull();
        const backoff1 = row?.scheduled_at.getTime() ?? 0;
        expect(backoff1).toBeGreaterThan(t0 + 45_000);
        expect(backoff1).toBeLessThan(t0 + 75_000);

        await runReviewRequestTick(pool, logger, { now: new Date(t0 + 1_000) });
        expect((await reviewRowsForPatient(patientId))[0]?.attempts).toBe(1);

        await runReviewRequestTick(pool, logger, { now: new Date(t0 + 70_000) });
        row = (await reviewRowsForPatient(patientId))[0];
        expect(row?.attempts).toBe(2);

        await runReviewRequestTick(pool, logger, { now: new Date(t0 + 200_000) });
        row = (await reviewRowsForPatient(patientId))[0];
        expect(row?.attempts).toBe(3);
        expect(row?.status).toBe('FAILED');

        await runReviewRequestTick(pool, logger, { now: new Date(t0 + 600_000) });
        row = (await reviewRowsForPatient(patientId))[0];
        expect(row?.attempts).toBe(3);
        expect(row?.status).toBe('FAILED');

        const msg = await messageByKey(`review:${reviewId}`);
        expect(msg?.status).toBe('FAILED');
        expect(msg?.recipient).toBe('999999999');
        expect(await commCountForReview(reviewId)).toBe(1);
      } finally {
        await resetReviewConfig();
      }
    });

    it('handles unknown ids without throwing', async () => {
      const created = await createReviewRequestForCompletedAppointment(pool, logger, {
        appointmentId: 999_999_999,
      });
      expect(created).toEqual({
        created: false,
        reviewRequestId: null,
        status: null,
        reason: 'appointment_not_completed',
      });
      const unknownRoute = await request(app)
        .patch('/api/organizations/999999')
        .set('Cookie', ownerCookie)
        .send({ reviewUrl: 'https://example.com/x' });
      expect(unknownRoute.status).toBe(404);
    });
  },
);
