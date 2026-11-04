import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { createApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { PUBLIC_ACTIVITY_SQL } from '../src/services/publicActivity';

const testHost = process.env.TEST_DB_HOST;
const NOW = Date.parse('2099-06-01T12:00:00.000Z');
const REAL_ORG = 'Activity Feed Clinic';
const TEST_ORG = 'ZZ TEST Activity Feed';
const SECRET_NAME = 'Noura Alhadi';
const SECRET_PHONE = '+97355500199';
const SECRET_EMAIL = 'noura.alhadi@example.com';
const SECRET_BODY = 'Please call Noura about the abscess';

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

describe.skipIf(testHost === undefined || testHost === '')(
  'public activity feed against MySQL',
  () => {
    let pool: mysql.Pool;
    let app: Express;
    let emptyApp: Express;
    let now = NOW;

    async function cleanup(): Promise<void> {
      const [orgs] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT id FROM organizations WHERE name IN (?, ?)',
        [REAL_ORG, TEST_ORG],
      );
      const ids = orgs.map((row) => Number(row.id));
      if (ids.length === 0) return;
      const marks = ids.map(() => '?').join(', ');
      await pool.query(
        `DELETE FROM communication_messages WHERE organization_id IN (${marks})`,
        ids,
      );
      await pool.query(`DELETE FROM appointments WHERE organization_id IN (${marks})`, ids);
      await pool.query(`DELETE FROM leads WHERE organization_id IN (${marks})`, ids);
      await pool.query(`DELETE FROM patients WHERE organization_id IN (${marks})`, ids);
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

      const [real] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        [REAL_ORG],
      );
      const [hidden] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        [TEST_ORG],
      );
      const realId = real.insertId;
      const hiddenId = hidden.insertId;
      const [patient] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO patients (organization_id, first_name, last_name, phone, email) VALUES (?, ?, ?, ?, ?)',
        [realId, 'Noura', 'Alhadi', SECRET_PHONE, SECRET_EMAIL],
      );

      await pool.query(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, email, requested_service, source, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'WEBSITE', ?, ?)`,
        [
          realId,
          'Noura',
          'Alhadi',
          SECRET_PHONE,
          SECRET_EMAIL,
          'Routine cleaning',
          SECRET_BODY,
          new Date(NOW - 12 * 60_000),
        ],
      );
      await pool.query(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, email, requested_service, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'WEBSITE', ?)`,
        [
          hiddenId,
          'Noura',
          'Alhadi',
          '+97355500999',
          SECRET_EMAIL,
          'cleaning',
          new Date(NOW - 30_000),
        ],
      );
      await pool.query(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, requested_service, source, created_at)
         VALUES (?, ?, ?, ?, ?, 'MANUAL', ?)`,
        [realId, 'Old', 'Lead', '+97355500001', 'cleaning', new Date(NOW - 3 * 24 * 60 * 60 * 1000)],
      );
      await pool.query(
        `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time, service, provider, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [realId, patient.insertId, '2099-06-02', '10:30:00', 'whitening', SECRET_NAME, new Date(NOW - 4 * 60_000)],
      );
      await pool.query(
        `INSERT INTO communication_messages
           (organization_id, channel, direction, recipient, body, status, idempotency_key, sent_at, created_at)
         VALUES (?, 'SMS', 'OUTBOUND', ?, ?, 'SENT', ?, ?, ?)`,
        [realId, SECRET_PHONE, SECRET_BODY, 'activity-feed-sent', new Date(NOW - 20_000), new Date(NOW - 20_000)],
      );
      await pool.query(
        `INSERT INTO communication_messages
           (organization_id, channel, direction, recipient, body, status, idempotency_key, created_at)
         VALUES (?, 'WHATSAPP', 'INBOUND', ?, ?, 'RECEIVED', ?, ?)`,
        [realId, SECRET_PHONE, SECRET_BODY, 'activity-feed-inbound', new Date(NOW - 10_000)],
      );
      await pool.query(
        `INSERT INTO communication_messages
           (organization_id, channel, direction, recipient, body, status, idempotency_key, sent_at, created_at)
         VALUES (?, 'SMS', 'OUTBOUND', ?, ?, 'SENT', ?, ?, ?)`,
        [
          hiddenId,
          SECRET_PHONE,
          'hidden clinic reply',
          'activity-feed-hidden',
          new Date(NOW - 5_000),
          new Date(NOW - 5_000),
        ],
      );

      app = createApp({ db: pool, publicActivity: { now: () => now, ttlMs: 45_000, perIp: 100 } });
      emptyApp = createApp({
        db: pool,
        publicActivity: { now: () => Date.parse('1980-01-02T00:00:00.000Z'), ttlMs: 45_000, perIp: 100 },
      });
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await cleanup();
        await pool.end();
      }
    });

    it('uses the created-at indexes', async () => {
      for (const [sql, index] of [
        [PUBLIC_ACTIVITY_SQL.leads, 'idx_leads_created'],
        [PUBLIC_ACTIVITY_SQL.appointments, 'idx_appointments_created'],
        [PUBLIC_ACTIVITY_SQL.replies, 'idx_comm_messages_outbound_sent'],
      ] as const) {
        const [plan] = await pool.query<mysql.RowDataPacket[]>(`EXPLAIN ${sql}`, [
          new Date(NOW - 86_400_000),
          new Date(NOW),
          5,
        ]);
        expect(plan.some((row) => row.key === index)).toBe(true);
      }
    });

    it('returns anonymized recent events and hides ZZ TEST orgs', async () => {
      const res = await request(app).get('/api/public/activity');
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([
        { kind: 'reply', label: 'Reply sent', minutesAgo: 0 },
        { kind: 'booking', label: 'A clinic booked a whitening', minutesAgo: 4 },
        { kind: 'enquiry', label: 'New enquiry · cleaning', minutesAgo: 12 },
      ]);
      const serialized = JSON.stringify(res.body);
      for (const secret of [SECRET_NAME, SECRET_PHONE, SECRET_EMAIL, SECRET_BODY, REAL_ORG, TEST_ORG, '10:30']) {
        expect(serialized).not.toContain(secret);
      }
      for (const event of res.body.events as Array<Record<string, unknown>>) {
        expect(Object.keys(event).sort()).toEqual(['kind', 'label', 'minutesAgo']);
      }

      await pool.query(
        `INSERT INTO leads (organization_id, first_name, last_name, phone, requested_service, source, created_at)
         VALUES ((SELECT id FROM organizations WHERE name = ?), ?, ?, ?, 'emergency', 'WEBSITE', ?)`,
        [REAL_ORG, 'Noura', 'Alhadi', '+97355500198', new Date(NOW - 1_000)],
      );
      const cached = await request(app).get('/api/public/activity');
      expect(cached.body.events.map((event: { label: string }) => event.label)).not.toContain(
        'New enquiry · emergency',
      );

      now += 50_000;
      const refreshed = await request(app).get('/api/public/activity');
      expect(refreshed.body.events[0]).toMatchObject({
        kind: 'enquiry',
        label: 'New enquiry · emergency',
      });
      expect(JSON.stringify(refreshed.body)).not.toContain(SECRET_NAME);
    });

    it('returns an empty list when nothing is inside the recent window', async () => {
      const res = await request(emptyApp).get('/api/public/activity');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ events: [] });
    });
  },
);
