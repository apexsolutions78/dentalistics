import 'dotenv/config';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBillingTick } from '../src/automation/billing';
import { runReminderTick } from '../src/automation/reminders';
import type { DbConfig } from '../src/config';
import { MockProvider } from '../src/communications/mockProvider';
import { runMigrations } from '../src/db/migrate';
import {
  TIMESTAMP_CORRECTION_META_KEY,
  classifiedDatetimeColumns,
  correctLocalTimestamps,
} from '../src/db/localTimestamps';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';
import { getDashboard } from '../src/services/dashboard';
import { sendTemplateMessage } from '../src/services/messages';

const testHost = process.env.TEST_DB_HOST;

function testDbConfig(): DbConfig {
  return {
    host: testHost ?? '',
    port: Number(process.env.TEST_DB_PORT ?? '3306'),
    user: process.env.TEST_DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? '',
    database: 'dentalistics_timestamp_test',
  };
}

describe.skipIf(testHost === undefined || testHost === '')('UTC session and timestamp correction', () => {
  let pool: mysql.Pool;
  let cfg: DbConfig;

  beforeAll(async () => {
    cfg = testDbConfig();
    const admin = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      timezone: 'Z',
    });
    try {
      await admin.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.database}\``);
    } finally {
      await admin.end();
    }
    await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    pool = createPool(cfg);
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [TIMESTAMP_CORRECTION_META_KEY]);
  }, 60_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('forces every pool connection to UTC even if another connection is +05:00', async () => {
    const [session] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT @@session.time_zone AS tz, TIMESTAMPDIFF(SECOND, NOW(), UTC_TIMESTAMP()) AS skew_seconds',
    );
    expect(session[0]?.tz).toBe('+00:00');
    expect(Math.abs(Number(session[0]?.skew_seconds))).toBeLessThanOrEqual(1);

    const raw = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      timezone: 'Z',
    });
    try {
      await raw.query("SET time_zone = '+05:00'");
      const [skewed] = await raw.query<mysql.RowDataPacket[]>(
        'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS ahead_seconds',
      );
      const ahead = Number(skewed[0]?.ahead_seconds);
      expect(ahead).toBeGreaterThanOrEqual(17_900);
      expect(ahead).toBeLessThanOrEqual(18_100);

      const [inserted] = await raw.query<mysql.ResultSetHeader>(
        "INSERT INTO organizations (name, plan) VALUES ('TZ Skew Probe', 'trial')",
      );
      const [rawRow] = await raw.query<mysql.RowDataPacket[]>(
        'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), created_at) AS ahead_seconds FROM organizations WHERE id = ?',
        [inserted.insertId],
      );
      expect(Number(rawRow[0]?.ahead_seconds)).toBeGreaterThanOrEqual(17_900);
    } finally {
      await raw.end();
    }

    const [utcInsert] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO organizations (name, plan) VALUES ('TZ UTC Probe', 'trial')",
    );
    const [utcRow] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP()) AS lag_seconds FROM organizations WHERE id = ?',
      [utcInsert.insertId],
    );
    expect(Number(utcRow[0]?.lag_seconds)).toBeGreaterThanOrEqual(0);
    expect(Number(utcRow[0]?.lag_seconds)).toBeLessThanOrEqual(5);

    const instant = new Date('2026-11-04T07:34:00.000Z');
    await pool.query('UPDATE organizations SET trial_ends_at = ? WHERE id = ?', [instant, utcInsert.insertId]);
    const [roundTrip] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT trial_ends_at FROM organizations WHERE id = ?',
      [utcInsert.insertId],
    );
    expect((roundTrip[0]?.trial_ends_at as Date).toISOString()).toBe('2026-11-04T07:34:00.000Z');
  });

  it('keeps dashboard UTC day windows on the stored UTC clock', async () => {
    const [org] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO organizations (name, plan) VALUES ('TZ Dashboard Probe', 'full')",
    );
    await pool.query(
      `INSERT INTO leads (organization_id, first_name, last_name, phone, source, created_at, last_activity_at)
       VALUES (?, 'Late', 'Utc', '15550001001', 'MANUAL', '2026-11-04 23:30:00', '2026-11-04 23:30:00'),
              (?, 'Next', 'Utc', '15550001002', 'MANUAL', '2026-11-05 00:30:00', '2026-11-05 00:30:00')`,
      [org.insertId, org.insertId],
    );
    const sameDay = await getDashboard(pool, {
      organizationId: org.insertId,
      from: '2026-11-04',
      to: '2026-11-04',
    });
    const nextDay = await getDashboard(pool, {
      organizationId: org.insertId,
      from: '2026-11-05',
      to: '2026-11-05',
    });
    expect(sameDay.metrics.leads.new).toBe(1);
    expect(sameDay.trends.daily).toEqual([
      expect.objectContaining({ date: '2026-11-04', newLeads: 1 }),
    ]);
    expect(nextDay.metrics.leads.new).toBe(1);
  });

  it('shifts only pre-cutoff session-clock columns and refuses a second apply', async () => {
    const [present] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('datetime', 'timestamp')`,
    );
    const classified = classifiedDatetimeColumns();
    const missing = present
      .map((row) => `${row.table_name}.${row.column_name}`)
      .filter((key) => !classified.has(key));
    expect(missing).toEqual([]);

    const [org] = await pool.query<mysql.ResultSetHeader>(
      "INSERT INTO organizations (name, plan, trial_ends_at) VALUES ('TZ Correct Probe', 'trial', '2026-01-01 12:00:00')",
    );
    await pool.query('UPDATE organizations SET created_at = ? WHERE id = ?', ['2026-01-01 12:34:00', org.insertId]);
    await pool.query(
      `INSERT INTO leads (organization_id, first_name, last_name, phone, source, created_at, last_activity_at)
       VALUES (?, 'Same', 'Clock', '15550001003', 'MANUAL', '2026-01-01 12:34:00', '2026-01-01 12:34:00'),
              (?, 'Moved', 'Clock', '15550001004', 'MANUAL', '2026-01-01 12:34:00', '2026-01-02 08:00:00')`,
      [org.insertId, org.insertId],
    );
    await pool.query(
      `INSERT INTO patients (organization_id, first_name, last_name, phone)
       VALUES (?, 'Pat', 'Ient', '15550001005')`,
      [org.insertId],
    );
    const [patient] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT id FROM patients WHERE organization_id = ?',
      [org.insertId],
    );
    const patientId = patient[0]?.id as number;
    const [appointment] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time)
       VALUES (?, ?, '2026-12-01', '09:00:00')`,
      [org.insertId, patientId],
    );
    await pool.query(
      `INSERT INTO appointment_reminders (organization_id, appointment_id, offset_hours, scheduled_at)
       VALUES (?, ?, 2, '2026-01-01 12:34:00')`,
      [org.insertId, appointment.insertId],
    );

    const before = new Date('2026-02-01T00:00:00.000Z');
    const dry = await correctLocalTimestamps(pool, { offsetMinutes: 300, before, apply: false });
    expect(dry.status).toBe('dry_run');
    const created = dry.columns.find((column) => column.table === 'organizations' && column.column === 'created_at');
    expect(created?.rows).toBeGreaterThan(0);

    const applied = await correctLocalTimestamps(pool, { offsetMinutes: 300, before, apply: true });
    expect(applied.status).toBe('applied');

    const [orgRow] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(trial_ends_at, '%Y-%m-%d %H:%i:%s') AS trial_ends_at
       FROM organizations WHERE id = ?`,
      [org.insertId],
    );
    expect(orgRow[0]?.created_at).toBe('2026-01-01 07:34:00');
    expect(orgRow[0]?.trial_ends_at).toBe('2026-01-01 12:00:00');

    const [leads] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT phone,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(last_activity_at, '%Y-%m-%d %H:%i:%s') AS last_activity_at
       FROM leads WHERE organization_id = ? ORDER BY phone`,
      [org.insertId],
    );
    expect(leads[0]).toMatchObject({
      phone: '15550001003',
      created_at: '2026-01-01 07:34:00',
      last_activity_at: '2026-01-01 07:34:00',
    });
    expect(leads[1]).toMatchObject({
      phone: '15550001004',
      created_at: '2026-01-01 07:34:00',
      last_activity_at: '2026-01-02 08:00:00',
    });

    const [reminder] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(scheduled_at, '%Y-%m-%d %H:%i:%s') AS scheduled_at
       FROM appointment_reminders WHERE organization_id = ?`,
      [org.insertId],
    );
    expect(reminder[0]?.scheduled_at).toBe('2026-01-01 12:34:00');

    const second = await correctLocalTimestamps(pool, { offsetMinutes: 300, before, apply: true });
    expect(second.status).toBe('already_applied');
    const [still] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at FROM organizations WHERE id = ?`,
      [org.insertId],
    );
    expect(still[0]?.created_at).toBe('2026-01-01 07:34:00');
  });

  it('does not send a due reminder or a new template after the grace period', async () => {
    const logger = createLogger({ level: 'error', write: () => undefined });
    const [lapsed] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, plan, paid_until)
       VALUES ('TZ Lapsed Clinic', 'full', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 DAY))`,
    );
    const [entitled] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, plan, paid_until)
       VALUES ('TZ Paid Clinic', 'full', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 20 DAY))`,
    );

    async function dueReminder(organizationId: number, phone: string): Promise<number> {
      const [patient] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO patients (organization_id, first_name, last_name, phone)
         VALUES (?, 'Rem', 'Inder', ?)`,
        [organizationId, phone],
      );
      const [appointment] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time, status)
         VALUES (?, ?, '2026-12-20', '10:00:00', 'SCHEDULED')`,
        [organizationId, patient.insertId],
      );
      const [reminder] = await pool.query<mysql.ResultSetHeader>(
        `INSERT INTO appointment_reminders (organization_id, appointment_id, offset_hours, scheduled_at, status)
         VALUES (?, ?, 2, UTC_TIMESTAMP(), 'PENDING')`,
        [organizationId, appointment.insertId],
      );
      return reminder.insertId;
    }

    const lapsedReminder = await dueReminder(lapsed.insertId, '15550002001');
    const entitledReminder = await dueReminder(entitled.insertId, '15550002002');
    const tick = await runReminderTick(pool, logger, { now: new Date() });
    expect(tick.sent).toBeGreaterThanOrEqual(1);

    const [lapsedRow] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status, attempts FROM appointment_reminders WHERE id = ?',
      [lapsedReminder],
    );
    expect(lapsedRow[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    const [entitledRow] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT status FROM appointment_reminders WHERE id = ?',
      [entitledReminder],
    );
    expect(entitledRow[0]?.status).toBe('SENT');

    const provider = new MockProvider({ failOn: [] });
    const held = await sendTemplateMessage(pool, logger, provider, {
      organizationId: lapsed.insertId,
      channel: 'SMS',
      to: '15550002001',
      templateName: 'lead_acknowledgement',
      templateText: 'Hello {{first_name}}',
      variables: { first_name: 'Ada' },
      idempotencyKey: `tz-hold-${lapsed.insertId}`,
      messageType: 'lead_acknowledgement',
    });
    expect(held.held).toBe(true);
    expect(provider.attempts).toHaveLength(0);

    const first = await runBillingTick(pool, logger);
    expect(first.lapsed).toBe(1);
    const second = await runBillingTick(pool, logger);
    expect(second.lapsed).toBe(0);
    const [audits] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'subscription_expired'",
      [lapsed.insertId],
    );
    expect(Number(audits[0]?.n)).toBe(1);
  });
});
