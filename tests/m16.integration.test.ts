import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startNoShowRecovery } from '../src/automation/noShow';
import {
  DEFAULT_REMINDER_CONFIG,
  REMINDER_CONFIG_META_KEY,
} from '../src/automation/reminderConfig';
import { DEFAULT_REVIEW_CONFIG } from '../src/automation/reviewConfig';
import { runReminderTick } from '../src/automation/reminders';
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

describe.skipIf(testHost === undefined || testHost === '')(
  'M16 settings and automation configuration API',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let ownerCookie: string;
    let recCookie: string;
    let ownerBCookie: string;
    let adminCookie: string;
    let orgAId: number;
    let orgBId: number;

    const ownerEmail = 'owner.m16@apextest.local';
    const ownerPassword = 'OwnerM16Passw0rd!26x';
    const recEmail = 'rec.m16@apextest.local';
    const recPassword = 'RecM16Passw0rd!26x';
    const ownerBEmail = 'owner.m16b@apextest.local';
    const ownerBPassword = 'OwnerM16BPassw0rd!26x';
    const adminEmail = 'admin.m16@apextest.local';
    const adminPassword = 'AdminM16Passw0rd!26x';

    const orgAPhone = '+15551230000';
    const orgAPhoneDigits = '15551230000';

    async function insertOrg(name: string, timezone: string, phone: string | null): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name, site_key, timezone, phone) VALUES (?, ?, ?, ?)',
        [name, generateSiteKey(), timezone, phone],
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

    function settingsPath(org: number, suffix = ''): string {
      return `/api/organizations/${org}/settings${suffix}`;
    }

    async function getSettings(org: number, ck: string): Promise<Record<string, any>> {
      const res = await request(app).get(settingsPath(org)).set('Cookie', ck);
      expect(res.status).toBe(200);
      return res.body.settings as Record<string, any>;
    }

    async function patchSettings(
      org: number,
      ck: string,
      suffix: string,
      body: Record<string, unknown>,
    ): Promise<request.Response> {
      return request(app).patch(settingsPath(org, suffix)).set('Cookie', ck).send(body);
    }

    async function insertPatient(orgId: number, ck: string, phone: string): Promise<number> {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ck)
        .send({ firstName: 'M16', lastName: 'Patient', phone });
      expect(res.status).toBe(201);
      return res.body.patient.id as number;
    }

    async function createAppt(
      orgId: number,
      ck: string,
      patientId: number,
      date: string,
      time: string,
    ): Promise<number> {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ck)
        .send({ patientId, date, time });
      expect(res.status).toBe(201);
      return res.body.appointment.id as number;
    }

    async function reminderOffsets(appointmentId: number): Promise<number[]> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT offset_hours FROM appointment_reminders WHERE appointment_id = ? ORDER BY offset_hours DESC',
        [appointmentId],
      );
      return rows.map((row) => row.offset_hours as number);
    }

    async function backdate(appointmentId: number, offsetHours: number): Promise<void> {
      await pool.query(
        `UPDATE appointment_reminders
         SET scheduled_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 SECOND)
         WHERE appointment_id = ? AND offset_hours = ?`,
        [appointmentId, offsetHours],
      );
    }

    async function messageById(id: number): Promise<{ body: string; status: string } | null> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT body, status FROM communication_messages WHERE id = ?',
        [id],
      );
      const row = rows[0];
      return row === undefined ? null : { body: row.body as string, status: row.status as string };
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
      await pool.query('DELETE FROM organization_settings');
      await pool.query('DELETE FROM app_meta');

      orgAId = await insertOrg('M16 Clinic', 'UTC', orgAPhone);
      orgBId = await insertOrg('M16 Clinic B', 'Pacific/Kiritimati', null);
      await insertUser(orgAId, ownerEmail, ownerPassword, 'owner');
      await insertUser(orgAId, recEmail, recPassword, 'receptionist');
      await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
      await insertUser(null, adminEmail, adminPassword, 'admin');

      const logger = createLogger({ level: 'error', write: () => undefined });
      app = createApp({ db: pool, logger });

      ownerCookie = await login(ownerEmail, ownerPassword);
      recCookie = await login(recEmail, recPassword);
      ownerBCookie = await login(ownerBEmail, ownerBPassword);
      adminCookie = await login(adminEmail, adminPassword);
    }, 60_000);

    afterAll(async () => {
      await pool.end();
    });

    it('enforces settings authorization and returns the full settings shape', async () => {
      const unauth = await request(app).get(settingsPath(orgAId));
      expect(unauth.status).toBe(401);

      const forbidden = await request(app).get(settingsPath(orgAId)).set('Cookie', recCookie);
      expect(forbidden.status).toBe(403);

      const forbiddenPatch = await patchSettings(orgAId, recCookie, '/clinic', {
        name: 'Nope',
      });
      expect(forbiddenPatch.status).toBe(403);

      const foreign = await request(app).get(settingsPath(orgAId)).set('Cookie', ownerBCookie);
      expect(foreign.status).toBe(404);

      const settings = await getSettings(orgAId, ownerCookie);
      expect(settings.clinic).toEqual({
        name: 'M16 Clinic',
        phone: orgAPhone,
        email: null,
        address: null,
        logoUrl: null,
        businessHours: null,
        timezone: 'UTC',
        reviewUrl: null,
      });
      expect(Object.keys(settings.automations as object).sort()).toEqual([
        'leadAck',
        'leadAutomation',
        'missedCall',
        'noShow',
        'recall',
        'reminder',
        'review',
      ]);
      for (const key of Object.keys(settings.automations as object)) {
        const section = (settings.automations as Record<string, any>)[key];
        expect(section.source).toBe('default');
        expect(typeof section.config.enabled).toBe('boolean');
      }
      expect(Object.keys(settings.providers as object).sort()).toEqual(['telephony', 'whatsapp']);
      expect(settings.providers.telephony.source).toBe('default');
      expect(settings.providers.whatsapp.source).toBe('default');
      expect(settings.providers.telephony.configured).toEqual({ signingSecret: false });
      expect(Object.keys(settings.templates as object).sort()).toEqual(
        [
          'appointment_confirmation',
          'appointment_reminder_24h',
          'appointment_reminder_2h',
          'appointment_reminder_48h',
          'lead_acknowledgement',
          'missed_call_response',
          'no_show_follow_up',
          'no_show_message',
          'recall_follow_up',
          'recall_message',
          'review_request',
        ].sort(),
      );
      expect(settings.definitions.automationKeys).toContain('reminder');
      expect(settings.definitions.templateVariables.map((v: any) => v.name)).toContain(
        'clinic_phone',
      );
      expect(settings.definitions.roleMatrix.receptionist).toEqual([]);

      const asAdmin = await getSettings(orgAId, adminCookie);
      expect(asAdmin.clinic.name).toBe('M16 Clinic');
    });

    it('updates the clinic profile with validation and clears nullable fields', async () => {
      const full = {
        name: 'M16 Clinic Updated',
        phone: '+15557654321',
        email: 'clinic@m16.test',
        address: '12 King Road',
        logoUrl: 'https://cdn.m16.test/logo.png',
        businessHours: {
          mon: { open: '08:00', close: '17:00' },
          tue: { open: '08:00', close: '17:00' },
          wed: { open: '08:00', close: '17:00' },
          thu: { open: '08:00', close: '17:00' },
          fri: null,
          sat: { open: '09:00', close: '13:00' },
          sun: null,
        },
        timezone: 'Asia/Bahrain',
        reviewUrl: 'https://reviews.m16.test',
      };
      const res = await patchSettings(orgAId, ownerCookie, '/clinic', full);
      expect(res.status).toBe(200);
      const clinic = res.body.settings.clinic;
      expect(clinic.name).toBe('M16 Clinic Updated');
      expect(clinic.phone).toBe('15557654321');
      expect(clinic.email).toBe('clinic@m16.test');
      expect(clinic.address).toBe('12 King Road');
      expect(clinic.logoUrl).toBe('https://cdn.m16.test/logo.png');
      expect(clinic.businessHours).toEqual(full.businessHours);
      expect(clinic.timezone).toBe('Asia/Bahrain');
      expect(clinic.reviewUrl).toBe('https://reviews.m16.test');

      const missingDay = await patchSettings(orgAId, ownerCookie, '/clinic', {
        businessHours: { mon: { open: '08:00', close: '17:00' } },
      });
      expect(missingDay.status).toBe(400);

      const openLate = await patchSettings(orgAId, ownerCookie, '/clinic', {
        businessHours: { ...full.businessHours, tue: { open: '17:00', close: '08:00' } },
      });
      expect(openLate.status).toBe(400);

      const badTime = await patchSettings(orgAId, ownerCookie, '/clinic', {
        businessHours: { ...full.businessHours, tue: { open: '25:00', close: '26:00' } },
      });
      expect(badTime.status).toBe(400);

      const extraKey = await patchSettings(orgAId, ownerCookie, '/clinic', {
        businessHours: { ...full.businessHours, holiday: null },
      });
      expect(extraKey.status).toBe(400);

      const badLogo = await patchSettings(orgAId, ownerCookie, '/clinic', {
        logoUrl: 'ftp://cdn.m16.test/logo.png',
      });
      expect(badLogo.status).toBe(400);

      const longName = await patchSettings(orgAId, ownerCookie, '/clinic', {
        name: 'N'.repeat(121),
      });
      expect(longName.status).toBe(400);

      const unknownField = await patchSettings(orgAId, ownerCookie, '/clinic', {
        slogan: 'we care',
      });
      expect(unknownField.status).toBe(400);

      const badTimezone = await patchSettings(orgAId, ownerCookie, '/clinic', {
        timezone: 'Nope/Nowhere',
      });
      expect(badTimezone.status).toBe(400);

      const badPhone = await patchSettings(orgAId, ownerCookie, '/clinic', { phone: 'abc' });
      expect(badPhone.status).toBe(400);

      const emptyBody = await patchSettings(orgAId, ownerCookie, '/clinic', {});
      expect(emptyBody.status).toBe(400);

      const restore = await patchSettings(orgAId, ownerCookie, '/clinic', {
        name: 'M16 Clinic',
        phone: orgAPhone,
        email: '',
        address: '',
        logoUrl: '',
        businessHours: null,
        timezone: 'UTC',
        reviewUrl: '',
      });
      expect(restore.status).toBe(200);
      expect(restore.body.settings.clinic).toEqual({
        name: 'M16 Clinic',
        phone: orgAPhoneDigits,
        email: null,
        address: null,
        logoUrl: null,
        businessHours: null,
        timezone: 'UTC',
        reviewUrl: null,
      });

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT detail FROM audit_logs
         WHERE organization_id = ? AND action = 'settings_updated' AND detail LIKE 'section=clinic%'
         ORDER BY id DESC LIMIT 1`,
        [orgAId],
      );
      expect(auditRows[0]?.detail).toContain('fields=');
      expect(auditRows[0]?.detail).toContain('businessHours');
    });

    it('applies reminder offsets, disabled pause, and creation gating from org config', async () => {
      const patched = await patchSettings(orgAId, ownerCookie, '/automations/reminder', {
        offsetsHours: [5],
      });
      expect(patched.status).toBe(200);
      expect(patched.body.settings.automations.reminder.source).toBe('org');
      expect(patched.body.settings.automations.reminder.config.offsetsHours).toEqual([5]);

      const patientA = await insertPatient(orgAId, ownerCookie, '+15550100401');
      const apptA = await createAppt(orgAId, ownerCookie, patientA, '2026-12-01', '09:00');
      expect(await reminderOffsets(apptA)).toEqual([5]);

      const disabled = await patchSettings(orgAId, ownerCookie, '/automations/reminder', {
        enabled: false,
      });
      expect(disabled.status).toBe(200);
      expect(disabled.body.settings.automations.reminder.config.enabled).toBe(false);
      expect(disabled.body.settings.automations.reminder.config.offsetsHours).toEqual([5]);

      const gated = await createAppt(orgAId, ownerCookie, patientA, '2026-12-02', '10:00');
      expect(await reminderOffsets(gated)).toEqual([]);

      await backdate(apptA, 5);
      const pausedTick = await runReminderTick(
        pool,
        createLogger({ level: 'error', write: () => undefined }),
      );
      expect(pausedTick.processed).toBe(0);
      const [pausedRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status FROM appointment_reminders WHERE appointment_id = ? AND offset_hours = 5',
        [apptA],
      );
      expect(pausedRows[0]?.status).toBe('PENDING');

      const reenabled = await patchSettings(orgAId, ownerCookie, '/automations/reminder', {
        enabled: true,
      });
      expect(reenabled.status).toBe(200);

      const logger = createLogger({ level: 'error', write: () => undefined });
      const resumed = await runReminderTick(pool, logger);
      expect(resumed.sent).toBeGreaterThanOrEqual(1);
      const [resumedRows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status FROM appointment_reminders WHERE appointment_id = ? AND offset_hours = 5',
        [apptA],
      );
      expect(resumedRows[0]?.status).toBe('SENT');
    });

    it('renders a patched template with clinic variables on the send path', async () => {
      const templateBody =
        'REM16 {{first_name}} at {{clinic_name}} ph {{clinic_phone}} on {{appointment_date}}';
      const offsets = await patchSettings(orgAId, ownerCookie, '/automations/reminder', {
        offsetsHours: [24],
      });
      expect(offsets.status).toBe(200);

      const patched = await patchSettings(
        orgAId,
        ownerCookie,
        '/templates/appointment_reminder_24h',
        { body: templateBody },
      );
      expect(patched.status).toBe(200);
      expect(patched.body.settings.templates.appointment_reminder_24h).toBe(templateBody);
      expect(patched.body.settings.automations.reminder.config.templates['24']).toBe(templateBody);

      const patientA = await insertPatient(orgAId, ownerCookie, '+15550100402');
      const apptId = await createAppt(orgAId, ownerCookie, patientA, '2026-12-03', '11:00');
      expect(await reminderOffsets(apptId)).toEqual([24]);

      await backdate(apptId, 24);
      const logger = createLogger({ level: 'error', write: () => undefined });
      const tick = await runReminderTick(pool, logger);
      expect(tick.sent).toBeGreaterThanOrEqual(1);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT message_id FROM appointment_reminders WHERE appointment_id = ? AND offset_hours = 24',
        [apptId],
      );
      const messageId = rows[0]?.message_id as number | null;
      expect(messageId).not.toBeNull();
      const message = await messageById(messageId ?? 0);
      expect(message?.status).toBe('SENT');
      expect(message?.body).toContain('REM16');
      expect(message?.body).toContain('M16 Clinic');
      expect(message?.body).toContain(orgAPhoneDigits);
      expect(message?.body).not.toContain('{{');
    });

    it('keeps org A configuration changes from affecting org B', async () => {
      const settingsB = await getSettings(orgBId, ownerBCookie);
      expect(settingsB.automations.reminder.source).toBe('default');
      expect(settingsB.automations.reminder.config.offsetsHours).toEqual(
        DEFAULT_REMINDER_CONFIG.offsetsHours,
      );
      expect(settingsB.automations.reminder.config.enabled).toBe(true);

      const patientB = await insertPatient(orgBId, ownerBCookie, '+15550100403');
      const apptB = await createAppt(orgBId, ownerBCookie, patientB, '2026-12-04', '09:30');
      expect(await reminderOffsets(apptB)).toEqual([...DEFAULT_REMINDER_CONFIG.offsetsHours].sort((a, b) => b - a));
    });

    it('schedules the no-show follow-up and renders its template from org config', async () => {
      const patch = await patchSettings(orgAId, ownerCookie, '/automations/noShow', {
        followUpDelayHours: 6,
        templates: { initial: 'NS16 {{first_name}} at {{clinic_name}} ph {{clinic_phone}}' },
      });
      expect(patch.status).toBe(200);
      expect(patch.body.settings.automations.noShow.source).toBe('org');
      expect(patch.body.settings.automations.noShow.config.followUpDelayHours).toBe(6);

      const patientA = await insertPatient(orgAId, ownerCookie, '+15550100404');
      const apptId = await createAppt(orgAId, ownerCookie, patientA, '2026-12-05', '12:00');
      await pool.query("UPDATE appointments SET status = 'NO_SHOW' WHERE id = ?", [apptId]);

      const startedAt = Date.now();
      const started = await startNoShowRecovery(pool, createLogger({ level: 'error', write: () => undefined }), {
        appointmentId: apptId,
      });
      expect(started.started).toBe(true);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT phase, status, scheduled_at, message_id FROM no_show_messages WHERE case_id = ? ORDER BY id',
        [started.caseId ?? 0],
      );
      const followUp = rows.find((row) => row.phase === 'FOLLOW_UP');
      expect(followUp).toBeDefined();
      const followUpAt = new Date(followUp?.scheduled_at as Date).getTime();
      const expected = startedAt + 6 * 3600 * 1000;
      expect(Math.abs(followUpAt - expected)).toBeLessThan(5 * 60 * 1000);

      const initial = rows.find((row) => row.phase === 'INITIAL');
      expect(initial?.status).toBe('SENT');
      const message = await messageById(initial?.message_id as number);
      expect(message?.body).toContain('NS16');
      expect(message?.body).toContain(orgAPhoneDigits);
    });

    it('falls back through the deployment layer when the org config row is corrupt', async () => {
      const deploymentConfig = {
        ...DEFAULT_REMINDER_CONFIG,
        offsetsHours: [7],
      };
      await pool.query(
        `INSERT INTO app_meta (meta_key, meta_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [REMINDER_CONFIG_META_KEY, JSON.stringify(deploymentConfig)],
      );
      await pool.query(
        `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
        [orgAId, REMINDER_CONFIG_META_KEY, 'not-json'],
      );

      const settings = await getSettings(orgAId, ownerCookie);
      expect(settings.automations.reminder.source).toBe('deployment');
      expect(settings.automations.reminder.config.offsetsHours).toEqual([7]);

      const patientA = await insertPatient(orgAId, ownerCookie, '+15550100405');
      const apptId = await createAppt(orgAId, ownerCookie, patientA, '2026-12-06', '08:30');
      expect(await reminderOffsets(apptId)).toEqual([7]);

      await pool.query(
        'DELETE FROM organization_settings WHERE organization_id = ? AND meta_key = ?',
        [orgAId, REMINDER_CONFIG_META_KEY],
      );
      await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [REMINDER_CONFIG_META_KEY]);

      const restored = await getSettings(orgAId, ownerCookie);
      expect(restored.automations.reminder.source).toBe('default');
      expect(restored.automations.reminder.config.offsetsHours).toEqual(
        DEFAULT_REMINDER_CONFIG.offsetsHours,
      );
    });

    it('validates automation and template patches with partial merge semantics', async () => {
      const reviewTemplate = 'REV16 {{first_name}} loved {{clinic_name}}';
      const templatePatch = await patchSettings(
        orgAId,
        ownerCookie,
        '/templates/review_request',
        { body: reviewTemplate },
      );
      expect(templatePatch.status).toBe(200);
      expect(templatePatch.body.settings.templates.review_request).toBe(reviewTemplate);

      const merged = await patchSettings(orgAId, ownerCookie, '/automations/review', {
        enabled: false,
      });
      expect(merged.status).toBe(200);
      expect(merged.body.settings.automations.review.config.enabled).toBe(false);
      expect(merged.body.settings.automations.review.config.template).toBe(reviewTemplate);

      const roundTrip = await patchSettings(orgAId, ownerCookie, '/automations/review', {
        maxAttempts: 9,
      });
      expect(roundTrip.status).toBe(200);
      expect(roundTrip.body.settings.automations.review.config.maxAttempts).toBe(
        DEFAULT_REVIEW_CONFIG.maxAttempts,
      );

      const emptyOffsets = await patchSettings(orgAId, ownerCookie, '/automations/reminder', {
        offsetsHours: [],
      });
      expect(emptyOffsets.status).toBe(400);

      const unknownKey = await patchSettings(orgAId, ownerCookie, '/automations/telephony', {
        enabled: true,
      });
      expect(unknownKey.status).toBe(400);

      const unknownField = await patchSettings(orgAId, ownerCookie, '/automations/review', {
        bogus: 1,
      });
      expect(unknownField.status).toBe(400);

      const longTemplate = await patchSettings(
        orgAId,
        ownerCookie,
        '/templates/review_request',
        { body: 'X'.repeat(2001) },
      );
      expect(longTemplate.status).toBe(400);

      const emptyTemplate = await patchSettings(
        orgAId,
        ownerCookie,
        '/templates/review_request',
        { body: '' },
      );
      expect(emptyTemplate.status).toBe(400);

      const unknownTemplate = await patchSettings(
        orgAId,
        ownerCookie,
        '/templates/not_a_template',
        { body: 'hi' },
      );
      expect(unknownTemplate.status).toBe(400);
    });

    it('stores provider secrets write-only and redacts them from responses', async () => {
      const secret = 'tele-secret-16-never-echo';
      const tele = await patchSettings(orgAId, ownerCookie, '/providers/telephony', {
        signingSecret: secret,
      });
      expect(tele.status).toBe(200);
      expect(tele.body.settings.providers.telephony.configured.signingSecret).toBe(true);
      expect(tele.body.settings.providers.telephony.source).toBe('org');
      expect(JSON.stringify(tele.body)).not.toContain(secret);

      const cleared = await patchSettings(orgAId, ownerCookie, '/providers/telephony', {
        signingSecret: null,
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.settings.providers.telephony.configured.signingSecret).toBe(false);

      const whatSecrets = {
        verifyToken: 'wa-verify-16',
        appSecret: 'wa-app-16',
        graph: { accessToken: 'wa-token-16', phoneNumberId: 'wa-phone-16', apiVersion: 'v19.0' },
      };
      const whats = await patchSettings(orgAId, ownerCookie, '/providers/whatsapp', {
        verifyToken: whatSecrets.verifyToken,
        appSecret: whatSecrets.appSecret,
        graph: { accessToken: whatSecrets.graph.accessToken },
      });
      expect(whats.status).toBe(200);
      const provider = whats.body.settings.providers.whatsapp;
      expect(provider.configured).toEqual({
        verifyToken: true,
        appSecret: true,
        accessToken: true,
      });
      expect(provider.graph.phoneNumberId).toBe('');
      const raw = JSON.stringify(whats.body);
      expect(raw).not.toContain(whatSecrets.verifyToken);
      expect(raw).not.toContain(whatSecrets.appSecret);
      expect(raw).not.toContain(whatSecrets.graph.accessToken);

      const badEnabled = await patchSettings(orgAId, ownerCookie, '/providers/telephony', {
        enabled: 'yes',
      });
      expect(badEnabled.status).toBe(400);

      const badProvider = await patchSettings(orgAId, ownerCookie, '/providers/smtp', {
        enabled: true,
      });
      expect(badProvider.status).toBe(400);

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT detail FROM audit_logs
         WHERE organization_id = ? AND action = 'settings_updated' AND detail LIKE 'section=providers:whatsapp%'
         ORDER BY id DESC LIMIT 1`,
        [orgAId],
      );
      expect(auditRows[0]?.detail).toContain('graph');
      expect(auditRows[0]?.detail).not.toContain(whatSecrets.graph.accessToken);
    });

    it('previews templates with sample variables and reports unknown ones', async () => {
      const preview = await request(app)
        .post(settingsPath(orgAId, '/templates/preview'))
        .set('Cookie', ownerCookie)
        .send({ body: 'Hi {{first_name}} call {{clinic_phone}} at {{clinic_name}} {{mystery_var}}' });
      expect(preview.status).toBe(200);
      expect(preview.body.rendered).toContain('Sarah');
      expect(preview.body.rendered).toContain(orgAPhoneDigits);
      expect(preview.body.rendered).toContain('M16 Clinic');
      expect(preview.body.rendered).not.toContain('{{');
      expect(preview.body.unknownVariables).toEqual(['mystery_var']);

      const override = await request(app)
        .post(settingsPath(orgAId, '/templates/preview'))
        .set('Cookie', ownerCookie)
        .send({ body: 'Hi {{first_name}}', variables: { first_name: 'Zoe' } });
      expect(override.status).toBe(200);
      expect(override.body.rendered).toBe('Hi Zoe');

      const badVariable = await request(app)
        .post(settingsPath(orgAId, '/templates/preview'))
        .set('Cookie', ownerCookie)
        .send({ body: 'Hi {{first_name}}', variables: { mystery: 'x' } });
      expect(badVariable.status).toBe(400);

      const notAnObject = await request(app)
        .post(settingsPath(orgAId, '/templates/preview'))
        .set('Cookie', ownerCookie)
        .send('plain');
      expect(notAnObject.status).toBe(400);
    });
  },
);
