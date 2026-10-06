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

const ORG_NAME = 'LeadBooking Test Clinic';
const OWNER_EMAIL = 'owner.leadbooking@apextest.local';
const OWNER_PASSWORD = 'LeadBookingPassw0rd!26x';

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
  'Lead workflow: booking moves the lead to APPOINTMENT_BOOKED',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;

    let orgId = 0;
    let patientId = 0;
    let ck = '';

    async function cleanup(): Promise<void> {
      const [existing] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE name = ?',
        [ORG_NAME],
      );
      const cleanupOrgId = Number(existing[0]?.id ?? 0);
      if (cleanupOrgId !== 0) {
        await pool.query(
          `DELETE ar FROM appointment_reminders ar
           JOIN appointments a ON a.id = ar.appointment_id
           WHERE a.organization_id = ?`,
          [cleanupOrgId],
        );
        await pool.query('DELETE FROM appointments WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM lead_activities WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ?)', [cleanupOrgId]);
        await pool.query('DELETE FROM leads WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query('DELETE FROM patients WHERE organization_id = ?', [cleanupOrgId]);
        await pool.query(
          'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE organization_id = ? OR email = ?)',
          [cleanupOrgId, OWNER_EMAIL],
        );
        await pool.query('DELETE FROM users WHERE organization_id = ? OR email = ?', [
          cleanupOrgId,
          OWNER_EMAIL,
        ]);
        await pool.query(
          'DELETE FROM audit_logs WHERE organization_id = ?',
          [cleanupOrgId],
        );
        await pool.query('DELETE FROM organizations WHERE id = ?', [cleanupOrgId]);
      }
      await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', [OWNER_EMAIL]);
      await pool.query('DELETE FROM users WHERE email = ?', [OWNER_EMAIL]);
      orgId = 0;
    }

    async function insertLead(status: string, phone: string): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, source, status)
         VALUES (?, 'Book', 'Me', ?, 'MANUAL', ?)`,
        [orgId, phone, status],
      );
      return row.insertId;
    }

    async function leadStatus(leadId: number): Promise<string> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT status FROM leads WHERE id = ?',
        [leadId],
      );
      return rows[0]?.status as string;
    }

    async function statusChangeActivityCount(leadId: number): Promise<number> {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS c FROM lead_activities WHERE lead_id = ? AND action = 'status_changed'",
        [leadId],
      );
      return Number(rows[0]?.c ?? 0);
    }

    async function book(leadId: number | null): Promise<request.Response> {
      return request(app)
        .post(`/api/organizations/${orgId}/appointments`)
        .set('Cookie', ck)
        .send({
          patientId,
          leadId,
          date: '2026-11-03',
          time: '10:00',
          service: 'Check-up',
        });
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

      const hash = await hashPassword(OWNER_PASSWORD);
      const [orgRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        [ORG_NAME],
      );
      orgId = orgRow.insertId;
      await pool.query(
        'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [orgId, OWNER_EMAIL, hash, 'owner'],
      );
      const [patientRow] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO patients (organization_id, first_name, last_name, phone)
         VALUES (?, 'Book', 'Me', '+15550111000')`,
        [orgId],
      );
      patientId = patientRow.insertId;

      app = createApp({ db: pool });
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
      expect(login.status).toBe(200);
      ck = cookie(login);
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('moves a NEW lead to APPOINTMENT_BOOKED and records the activity', async () => {
      const leadId = await insertLead('NEW', '+15550111101');
      const res = await book(leadId);
      expect(res.status).toBe(201);
      expect(res.body.appointment.leadId).toBe(leadId);

      expect(await leadStatus(leadId)).toBe('APPOINTMENT_BOOKED');
      expect(await statusChangeActivityCount(leadId)).toBe(1);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT detail FROM lead_activities WHERE lead_id = ? AND action = ?',
        [leadId, 'status_changed'],
      );
      expect(rows[0]?.detail).toContain('NEW -> APPOINTMENT_BOOKED');
    });

    it('does not duplicate the status change when the lead is already booked', async () => {
      const leadId = await insertLead('QUALIFIED', '+15550111102');
      const first = await book(leadId);
      expect(first.status).toBe(201);
      expect(await leadStatus(leadId)).toBe('APPOINTMENT_BOOKED');
      expect(await statusChangeActivityCount(leadId)).toBe(1);

      const second = await book(leadId);
      expect(second.status).toBe(201);
      expect(await leadStatus(leadId)).toBe('APPOINTMENT_BOOKED');
      expect(await statusChangeActivityCount(leadId)).toBe(1);
    });

    it('leaves closed leads (LOST / CLOSED) untouched', async () => {
      const lostId = await insertLead('LOST', '+15550111103');
      const lostRes = await book(lostId);
      expect(lostRes.status).toBe(201);
      expect(await leadStatus(lostId)).toBe('LOST');
      expect(await statusChangeActivityCount(lostId)).toBe(0);

      const closedId = await insertLead('CLOSED', '+15550111104');
      const closedRes = await book(closedId);
      expect(closedRes.status).toBe(201);
      expect(await leadStatus(closedId)).toBe('CLOSED');
      expect(await statusChangeActivityCount(closedId)).toBe(0);
    });

    it('does not touch any lead when the appointment has no lead attached', async () => {
      const untouchedId = await insertLead('CONTACTED', '+15550111105');
      const res = await book(null);
      expect(res.status).toBe(201);
      expect(res.body.appointment.leadId).toBeNull();
      expect(await leadStatus(untouchedId)).toBe('CONTACTED');
      expect(await statusChangeActivityCount(untouchedId)).toBe(0);
    });
  },
);
