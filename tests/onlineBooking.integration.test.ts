import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/app';
import type { DbConfig } from '../src/config';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { BookingConfirmationMail } from '../src/mail/bookingMailer';
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

function utcDate(daysAhead: number): string {
  const now = new Date();
  const stamp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead));
  return stamp.toISOString().slice(0, 10);
}

const HOURS = JSON.stringify({
  mon: { open: '09:00', close: '17:00' },
  tue: { open: '09:00', close: '17:00' },
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '17:00' },
  sat: { open: '09:00', close: '17:00' },
  sun: { open: '09:00', close: '17:00' },
});

describe.skipIf(testHost === undefined || testHost === '')('online booking', () => {
  let pool: Pool;
  let app: Express;
  let limited: Express;
  let orgId: number;
  let expiredId: number;
  let doctorId: number;
  const siteKey = generateSiteKey();
  const expiredKey = generateSiteKey();
  const ownerEmail = 'book.online.owner@example.test';
  const deskEmail = 'book.online.desk@example.test';
  const password = 'BookingOwnerPass1';
  const sent: BookingConfirmationMail[] = [];

  const settings = {
    enabled: true,
    slotMinutes: 30,
    bufferMinutes: 0,
    minNoticeMinutes: 0,
    maxDaysAhead: 60,
    autoConfirm: false,
  };

  beforeAll(async () => {
    const cfg = testDbConfig();
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    const [org] = await pool.query<ResultSetHeader>(
      `INSERT INTO organizations (name, site_key, timezone, phone, address, plan, business_hours)
       VALUES ('ZZ TEST Booking Clinic', ?, 'UTC', '15550001000', '1 Test Street', 'full', ?)`,
      [siteKey, HOURS],
    );
    orgId = org.insertId;
    const [expired] = await pool.query<ResultSetHeader>(
      `INSERT INTO organizations (name, site_key, timezone, plan, trial_ends_at, business_hours)
       VALUES ('ZZ TEST Expired Booking', ?, 'UTC', 'trial', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY), ?)`,
      [expiredKey, HOURS],
    );
    expiredId = expired.insertId;
    const [doctor] = await pool.query<ResultSetHeader>(
      `INSERT INTO doctors (organization_id, name, specialty, work_hours, slot_minutes, is_active)
       VALUES (?, 'Dr Ada', 'General', ?, 30, 1), (?, 'Dr Inactive', NULL, ?, 30, 0)`,
      [orgId, HOURS, orgId, HOURS],
    );
    doctorId = doctor.insertId;
    await pool.query(
      `INSERT INTO doctors (organization_id, name, work_hours, slot_minutes, is_active)
       VALUES (?, 'Dr Expired', ?, 30, 1)`,
      [expiredId, HOURS],
    );
    await pool.query(
      `INSERT INTO patients (organization_id, first_name, last_name, phone, email)
       VALUES (?, 'Existing', 'Person', '15551110001', 'match@example.test')`,
      [orgId],
    );
    const hash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      [orgId, ownerEmail, hash, 'owner', orgId, deskEmail, hash, 'receptionist'],
    );
    const mailer = {
      async sendBookingConfirmation(input: BookingConfirmationMail) {
        sent.push(input);
        return { sent: true };
      },
    };
    app = createApp({ db: pool, bookingMailer: mailer, publicBookingRate: { writePerIp: 100, writePerKey: 100 } });
    limited = createApp({
      db: pool,
      bookingMailer: mailer,
      publicBookingRate: { writePerIp: 2, writePerKey: 100, windowMs: 60_000 },
    });
  }, 60_000);

  afterAll(async () => {
    if (pool === undefined) return;
    for (const id of [orgId, expiredId]) {
      if (id === undefined) continue;
      await pool.query('DELETE FROM booking_slot_holds WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM appointments WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM leads WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM patients WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM doctors WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM organization_settings WHERE organization_id = ?', [id]);
      await pool.query('DELETE FROM audit_logs WHERE organization_id = ?', [id]);
    }
    await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)', [
      'book.online.%@example.test',
    ]);
    await pool.query('DELETE FROM users WHERE email LIKE ?', ['book.online.%@example.test']);
    await pool.query('DELETE FROM organizations WHERE id IN (?, ?)', [orgId, expiredId]);
    await pool.end();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookie(res);
  }

  function book(body: Record<string, unknown>, key = siteKey) {
    return request(app).post(`/api/public/booking/${key}`).send(body);
  }

  it('lets the owner save booking settings and refuses a receptionist', async () => {
    const anon = await request(app).get(`/api/organizations/${orgId}/booking`);
    expect(anon.status).toBe(401);

    const desk = await login(deskEmail);
    const denied = await request(app).patch(`/api/organizations/${orgId}/booking`).set('Cookie', desk).send(settings);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');

    const owner = await login(ownerEmail);
    const saved = await request(app)
      .patch(`/api/organizations/${orgId}/booking`)
      .set('Cookie', owner)
      .send(settings);
    expect(saved.status).toBe(200);
    expect(saved.body.booking.enabled).toBe(true);
    expect(saved.body.booking.path).toBe(`/book/${siteKey}`);

    const expiredOwner = await request(app)
      .patch(`/api/organizations/${expiredId}/booking`)
      .set('Cookie', owner)
      .send(settings);
    expect(expiredOwner.status).toBe(404);
  });

  it('shows not available when booking is disabled or the clinic is read-only', async () => {
    const owner = await login(ownerEmail);
    await request(app)
      .patch(`/api/organizations/${orgId}/booking`)
      .set('Cookie', owner)
      .send({ ...settings, enabled: false });
    const hidden = await request(app).get(`/api/public/booking/${siteKey}`);
    expect(hidden.status).toBe(200);
    expect(hidden.body.available).toBe(false);
    expect(hidden.body.message).toMatch(/not available/i);
    const refused = await book({
      name: 'Pat Ient',
      phone: '15551110009',
      email: 'pat@example.test',
      reason: 'Cleaning',
      date: utcDate(2),
      time: '10:00',
      consent: true,
      doctorId: null,
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('booking_unavailable');

    await request(app)
      .patch(`/api/organizations/${expiredId}/booking`)
      .set('Cookie', owner)
      .send(settings);
    // The expired clinic has no owner in this test; enable it directly.
    await pool.query(
      `INSERT INTO organization_settings (organization_id, meta_key, meta_value)
       VALUES (?, 'online_booking', ?)
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)`,
      [expiredId, JSON.stringify(settings)],
    );
    const expiredPage = await request(app).get(`/api/public/booking/${expiredKey}`);
    expect(expiredPage.status).toBe(200);
    expect(expiredPage.body.available).toBe(false);
    expect(expiredPage.body.message).toMatch(/not available/i);

    await request(app).patch(`/api/organizations/${orgId}/booking`).set('Cookie', owner).send(settings);
  });

  it('matches an existing patient, records an online-booking lead, and can email a confirmation', async () => {
    const date = utcDate(3);
    const created = await book({
      name: 'Someone Else',
      phone: '15551110001',
      email: 'new-address@example.test',
      reason: 'Cleaning',
      notes: 'Morning is better',
      date,
      time: '10:00',
      consent: true,
      doctorId,
      companyWebsite: '',
    });
    expect(created.status).toBe(201);
    expect(created.body.confirmation).toBe('pending');
    expect(created.body.emailSent).toBe(true);
    expect(sent.at(-1)?.confirmed).toBe(false);

    const [patients] = await pool.query<RowDataPacket[]>(
      'SELECT id, first_name, email FROM patients WHERE organization_id = ? AND phone = ?',
      [orgId, '15551110001'],
    );
    expect(patients).toHaveLength(1);
    expect(patients[0]?.first_name).toBe('Existing');

    const [leads] = await pool.query<RowDataPacket[]>(
      `SELECT l.source, l.status, a.detail
       FROM leads l
       JOIN lead_activities a ON a.lead_id = l.id
       WHERE l.organization_id = ? AND l.phone = ?`,
      [orgId, '15551110001'],
    );
    expect(leads[0]?.source).toBe('ONLINE_BOOKING');
    expect(leads[0]?.status).toBe('NEW');
    expect(String(leads[0]?.detail)).toContain('online booking');

    const [appointments] = await pool.query<RowDataPacket[]>(
      'SELECT status, patient_id FROM appointments WHERE id = ?',
      [created.body.appointmentId],
    );
    expect(appointments[0]?.status).toBe('SCHEDULED');
    expect(appointments[0]?.patient_id).toBe(patients[0]?.id);

    const byEmail = await book({
      name: 'Mail Match',
      phone: '15551110002',
      email: 'match@example.test',
      reason: 'Checkup',
      date,
      time: '11:00',
      consent: true,
      doctorId: null,
    });
    expect(byEmail.status).toBe(201);
    const [same] = await pool.query<RowDataPacket[]>(
      'SELECT patient_id FROM appointments WHERE id = ?',
      [byEmail.body.appointmentId],
    );
    expect(same[0]?.patient_id).toBe(patients[0]?.id);

    const page = await request(app).get(`/api/public/booking/${siteKey}`);
    expect(page.body.doctors.map((doctor: { name: string }) => doctor.name)).toEqual(['Dr Ada']);
    const missing = await request(app).get(`/api/public/booking/${'a'.repeat(64)}`);
    expect(missing.status).toBe(404);
  });

  it('rejects a second booking of the same slot, including two requests at once', async () => {
    const date = utcDate(4);
    const body = {
      name: 'Race Patient',
      phone: '15551110003',
      email: 'race@example.test',
      reason: 'Filling',
      date,
      time: '15:00',
      consent: true,
      doctorId,
    };
    const [first, second] = await Promise.all([book(body), book({ ...body, phone: '15551110004', email: 'race2@example.test' })]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('slot_unavailable');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM appointments
       WHERE organization_id = ? AND appointment_date = ? AND appointment_time = '15:00:00'
         AND status IN ('SCHEDULED', 'CONFIRMED')`,
      [orgId, date],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('drops a honeypot submission and rate limits repeated posts', async () => {
    const date = utcDate(5);
    const [before] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM appointments WHERE organization_id = ?',
      [orgId],
    );
    const spam = await book({
      name: 'Bot',
      phone: '15551110008',
      email: 'bot@example.test',
      reason: 'Cleaning',
      date,
      time: '10:00',
      consent: true,
      companyWebsite: 'https://spam.example',
    });
    expect(spam.status).toBe(201);
    expect(spam.body.appointmentId).toBeUndefined();
    const [after] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM appointments WHERE organization_id = ?',
      [orgId],
    );
    expect(Number(after[0]?.n)).toBe(Number(before[0]?.n));

    const payload = {
      name: 'Limit Patient',
      phone: '15551110005',
      email: 'limit@example.test',
      reason: 'Cleaning',
      date,
      time: '12:00',
      consent: true,
    };
    const ok1 = await request(limited).post(`/api/public/booking/${siteKey}`).send(payload);
    const ok2 = await request(limited)
      .post(`/api/public/booking/${siteKey}`)
      .send({ ...payload, time: '12:30', phone: '15551110006', email: 'limit2@example.test' });
    const blocked = await request(limited)
      .post(`/api/public/booking/${siteKey}`)
      .send({ ...payload, time: '13:00', phone: '15551110007', email: 'limit3@example.test' });
    expect(ok1.status).toBe(201);
    expect(ok2.status).toBe(201);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
  });
});
