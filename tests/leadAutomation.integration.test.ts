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

const testHost = process.env.TEST_DB_HOST;

const ORG_NAME = 'LeadAutomation Test Clinic';
const OWNER_EMAIL = 'owner.leadautomation@apextest.local';
const OWNER_PASSWORD = 'LeadAutomationPassw0rd!26x';
const RECEPTIONIST_EMAIL = 'desk.leadautomation@apextest.local';
const RECEPTIONIST_PASSWORD = 'DeskLeadAutomation!26x';

const ALL_DAYS_HOURS = {
  mon: { open: '08:00', close: '20:00' },
  tue: { open: '08:00', close: '20:00' },
  wed: { open: '08:00', close: '20:00' },
  thu: { open: '08:00', close: '20:00' },
  fri: { open: '08:00', close: '20:00' },
  sat: { open: '08:00', close: '20:00' },
  sun: { open: '08:00', close: '20:00' },
};

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

function dateAdd(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

describe.skipIf(testHost === undefined || testHost === '')(
  'Lead automation: doctors, suggestions, approval',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;

    let orgId = 0;
    let ownerCookie = '';
    let receptionistCookie = '';
    let doctorId = 0;
    let patientId = 0;
    let phoneCounter = 0;

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = dateAdd(today, 1);
    const dayAfter = dateAdd(today, 2);

    async function cleanup(): Promise<void> {
      const [existing] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE name = ?',
        [ORG_NAME],
      );
      const cleanupOrgId = Number(existing[0]?.id ?? 0);
      if (cleanupOrgId !== 0) {
        await pool.query('DELETE FROM communication_messages WHERE organization_id = ?', [
          cleanupOrgId,
        ]);
        await pool.query(
          `DELETE ar FROM appointment_reminders ar
           JOIN appointments a ON a.id = ar.appointment_id
           WHERE a.organization_id = ?`,
          [cleanupOrgId],
        );
        await pool.query('DELETE FROM appointments WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query(
          'DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ?)',
          [cleanupOrgId],
        );
        await pool.query('DELETE FROM leads WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM patients WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM doctors WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query(
          'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE organization_id = ?)',
          [cleanupOrgId],
        );
        await pool.query('DELETE FROM users WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM audit_logs WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM organizations WHERE id = ?', [cleanupOrgId]);
      }
      await pool.query(
        'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (?, ?))',
        [OWNER_EMAIL, RECEPTIONIST_EMAIL],
      );
      await pool.query('DELETE FROM users WHERE email IN (?, ?)', [
        OWNER_EMAIL,
        RECEPTIONIST_EMAIL,
      ]);
      orgId = 0;
    }

    function nextPhone(): string {
      phoneCounter += 1;
      return `+1555900${String(phoneCounter).padStart(4, '0')}`;
    }

    async function createLead(service: string, source = 'MANUAL'): Promise<number> {
      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads`)
        .set('Cookie', ownerCookie)
        .send({
          firstName: 'Suggest',
          lastName: 'Me',
          phone: nextPhone(),
          source,
          requestedService: service,
        });
      expect(res.status).toBe(201);
      return Number(res.body.lead.id);
    }

    async function suggestionsFor(leadId: number): Promise<Array<Record<string, unknown>>> {
      const res = await request(app)
        .get(`/api/organizations/${orgId}/leads/${leadId}/suggestions`)
        .set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      return res.body.suggestions as Array<Record<string, unknown>>;
    }

    async function leadStatus(leadId: number): Promise<string> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status FROM leads WHERE id = ?',
        [leadId],
      );
      return String(rows[0]?.status);
    }

    async function activityActions(leadId: number): Promise<string[]> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT action FROM lead_activities WHERE lead_id = ? ORDER BY id ASC',
        [leadId],
      );
      return rows.map((row) => String(row.action));
    }

    async function availability(
      doctor: number,
      date: string,
      as: string = ownerCookie,
    ): Promise<request.Response> {
      return request(app)
        .get(`/api/organizations/${orgId}/doctors/${doctor}/availability?date=${date}`)
        .set('Cookie', as);
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
      await cleanup();

      const ownerHash = await hashPassword(OWNER_PASSWORD);
      const deskHash = await hashPassword(RECEPTIONIST_PASSWORD);
      const [orgRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        [ORG_NAME],
      );
      orgId = orgRow.insertId;
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [orgId, OWNER_EMAIL, ownerHash, 'owner'],
      );
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [orgId, RECEPTIONIST_EMAIL, deskHash, 'receptionist'],
      );

      app = createApp({ db: pool });

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
      expect(login.status).toBe(200);
      ownerCookie = cookie(login);

      const deskLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: RECEPTIONIST_EMAIL, password: RECEPTIONIST_PASSWORD });
      expect(deskLogin.status).toBe(200);
      receptionistCookie = cookie(deskLogin);

      const doctorRes = await request(app)
        .post(`/api/organizations/${orgId}/doctors`)
        .set('Cookie', ownerCookie)
        .send({
          name: 'Dr Noor',
          specialty: 'General dentistry',
          workHours: ALL_DAYS_HOURS,
          slotMinutes: 30,
        });
      expect(doctorRes.status).toBe(201);
      doctorId = Number(doctorRes.body.doctor.id);

      const patientRes = await request(app)
        .post(`/api/organizations/${orgId}/patients`)
        .set('Cookie', ownerCookie)
        .send({ firstName: 'Slot', lastName: 'Tester', phone: nextPhone() });
      expect(patientRes.status).toBe(201);
      patientId = Number(patientRes.body.patient.id);
    }, 60_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('lets the receptionist manage the Doctors Panel', async () => {
      const list = await request(app)
        .get(`/api/organizations/${orgId}/doctors`)
        .set('Cookie', receptionistCookie);
      expect(list.status).toBe(200);
      expect(
        (list.body.doctors as Array<{ id: number }>).some((doctor) => doctor.id === doctorId),
      ).toBe(true);

      const created = await request(app)
        .post(`/api/organizations/${orgId}/doctors`)
        .set('Cookie', receptionistCookie)
        .send({ name: 'Dr Reception Add', workHours: ALL_DAYS_HOURS, slotMinutes: 30 });
      expect(created.status).toBe(201);

      const removed = await request(app)
        .delete(`/api/organizations/${orgId}/doctors/${created.body.doctor.id}`)
        .set('Cookie', receptionistCookie);
      expect(removed.status).toBe(200);
      expect(removed.body.doctor.isActive).toBe(false);
    });

    it('lists free slots inside working hours and excludes inactive doctors', async () => {
      const res = await availability(doctorId, tomorrow);
      expect(res.status).toBe(200);
      expect(res.body.withinHours).toBe(true);
      expect(res.body.slotMinutes).toBe(30);
      expect(res.body.slots.length).toBe(24);
      expect(res.body.slots[0]).toBe('08:00');
      expect(res.body.slots).toContain('19:30');

      const weekend = await availability(doctorId, dateAdd(tomorrow, 1));
      expect(weekend.body.withinHours).toBe(true);
      expect((weekend.body.slots as string[]).length).toBeGreaterThan(0);
    });

    it('computes urgency and generates slot suggestions when a lead is created', async () => {
      const leadId = await createLead('Broken tooth bleeding', 'WEBSITE');

      const detail = await request(app)
        .get(`/api/organizations/${orgId}/leads/${leadId}`)
        .set('Cookie', ownerCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.lead.urgencyLevel).toBe('HIGH');
      expect(detail.body.lead.urgencyReasons.length).toBeGreaterThan(0);

      const actions = await activityActions(leadId);
      expect(actions).toContain('urgency_computed');
      expect(actions).toContain('suggestions_generated');

      const suggestions = await suggestionsFor(leadId);
      expect(suggestions.length).toBeGreaterThan(0);
      const pending = suggestions.filter((item) => item.status === 'PENDING');
      expect(pending.length).toBeGreaterThan(0);
      for (const item of pending) {
        expect(item.doctorId).toBe(doctorId);
        expect(item.urgencyLevel).toBe('HIGH');
      }
    });

    it('approves a suggestion into an appointment, books the lead, and queues a confirmation', async () => {
      const leadId = await createLead('Routine cleaning');
      const pending = (await suggestionsFor(leadId)).filter((item) => item.status === 'PENDING');
      expect(pending.length).toBeGreaterThan(0);
      const suggestion = pending[0] as { id: number; doctorId: number; slotDate: string; slotTime: string };

      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads/${leadId}/suggestions/${suggestion.id}/approve`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.suggestion.status).toBe('ACCEPTED');
      expect(res.body.appointment.doctorId).toBe(doctorId);
      expect(res.body.appointment.date).toBe(suggestion.slotDate);
      expect(String(res.body.appointment.time).slice(0, 5)).toBe(
        String(suggestion.slotTime).slice(0, 5),
      );

      expect(await leadStatus(leadId)).toBe('APPOINTMENT_BOOKED');

      const [messageRows] = await pool.query<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM communication_messages
         WHERE lead_id = ? AND message_type = 'appointment_confirmation'`,
        [leadId],
      );
      expect(Number(messageRows[0]?.c)).toBeGreaterThan(0);

      const refreshed = await suggestionsFor(leadId);
      const decided = refreshed.find((item) => item.id === suggestion.id);
      expect(decided?.status).toBe('ACCEPTED');
      expect(decided?.appointmentId).toBe(res.body.appointment.id);
    });

    it('supports approving a suggestion into a different free slot (reschedule)', async () => {
      const leadId = await createLead('Check-up');
      const pending = (await suggestionsFor(leadId)).filter((item) => item.status === 'PENDING');
      expect(pending.length).toBeGreaterThan(0);
      const suggestion = pending[0] as { id: number; slotDate: string; slotTime: string };

      const free = await availability(doctorId, tomorrow);
      expect(free.status).toBe(200);
      const slots = free.body.slots as string[];
      expect(slots.length).toBeGreaterThan(0);
      const newTime = String(slots[slots.length - 1]);
      expect(newTime).not.toBe(String(suggestion.slotTime).slice(0, 5));

      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads/${leadId}/suggestions/${suggestion.id}/approve`)
        .set('Cookie', ownerCookie)
        .send({ date: tomorrow, time: newTime });
      expect(res.status).toBe(201);
      expect(res.body.suggestion.status).toBe('RESCHEDULED');
      expect(String(res.body.appointment.time).startsWith(newTime)).toBe(true);
      expect(res.body.appointment.date).toBe(tomorrow);

      expect(await leadStatus(leadId)).toBe('APPOINTMENT_BOOKED');
    });

    it('rejects approving outside the doctor working hours', async () => {
      const leadId = await createLead('Whitening');
      const pending = (await suggestionsFor(leadId)).filter((item) => item.status === 'PENDING');
      expect(pending.length).toBeGreaterThan(0);
      const suggestion = pending[0] as { id: number; slotDate: string };
      const outsideDate = suggestion.slotDate >= tomorrow ? suggestion.slotDate : tomorrow;

      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads/${leadId}/suggestions/${suggestion.id}/approve`)
        .set('Cookie', ownerCookie)
        .send({ date: outsideDate, time: '03:00' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('slot_unavailable');
      expect(await leadStatus(leadId)).not.toBe('APPOINTMENT_BOOKED');
    });

    it('declines a suggestion without changing the lead status', async () => {
      const leadId = await createLead('X-ray');
      const pending = (await suggestionsFor(leadId)).filter((item) => item.status === 'PENDING');
      expect(pending.length).toBeGreaterThan(0);
      const suggestion = pending[0] as { id: number };

      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads/${leadId}/suggestions/${suggestion.id}/decline`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.suggestion.status).toBe('DECLINED');
      expect(await leadStatus(leadId)).toBe('NEW');
    });

    it('blocks double-booking an occupied slot and bookings outside working hours', async () => {
      const free = await availability(doctorId, dayAfter);
      expect(free.status).toBe(200);
      const slots = free.body.slots as string[];
      expect(slots.length).toBeGreaterThan(0);
      const slot = String(slots[slots.length - 1]);

      const first = await request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ownerCookie)
        .send({ patientId, doctorId, date: dayAfter, time: slot, service: 'Slot test' });
      expect(first.status).toBe(201);
      expect(first.body.appointment.doctorId).toBe(doctorId);

      const again = await request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ownerCookie)
        .send({ patientId, doctorId, date: dayAfter, time: slot, service: 'Slot test again' });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('slot_unavailable');

      const outside = await request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ownerCookie)
        .send({ patientId, doctorId, date: dayAfter, time: '03:00', service: 'Too early' });
      expect(outside.status).toBe(409);
      expect(outside.body.error.code).toBe('slot_unavailable');

      const doctorless = await request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ownerCookie)
        .send({ patientId, date: dayAfter, time: '07:00', service: 'No doctor' });
      expect(doctorless.status).toBe(201);
      expect(doctorless.body.appointment.doctorId).toBeNull();
    });

    it('regenerates suggestions through the refresh endpoint', async () => {
      const leadId = await createLead('Filling');
      const before = await suggestionsFor(leadId);
      expect(before.length).toBeGreaterThan(0);

      const res = await request(app)
        .post(`/api/organizations/${orgId}/leads/${leadId}/suggestions/refresh`)
        .set('Cookie', ownerCookie)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect((res.body.suggestions as Array<Record<string, unknown>>).length).toBeGreaterThan(0);

      const after = await suggestionsFor(leadId);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((item) => item.status === 'PENDING' || item.status === 'EXPIRED')).toBe(true);
    });
  },
);
