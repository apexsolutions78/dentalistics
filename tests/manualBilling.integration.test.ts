import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
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

describe.skipIf(testHost === undefined || testHost === '')('regional prices and manual payments', () => {
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let adminCookie: string;
  let orgId: number;
  let existingTrialEnds: Date;
  const receiptDir = path.join(os.tmpdir(), `dentalistics-receipts-${process.pid}`);

  beforeAll(async () => {
    process.env.PAYMENT_RECEIPT_DIR = receiptDir;
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
    await pool.query("DELETE FROM setup_help_requests WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Manual Pay Clinic')");
    await pool.query("DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Manual Pay Clinic' OR name = 'Existing Trial Clinic')");
    await pool.query("DELETE FROM patients WHERE organization_id IN (SELECT id FROM organizations WHERE name = 'Manual Pay Clinic')");
    await pool.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email IN ('owner.manual@apextest.local', 'admin.manual@apextest.local'))");
    await pool.query("DELETE FROM users WHERE email IN ('owner.manual@apextest.local', 'admin.manual@apextest.local')");
    await pool.query("DELETE FROM organizations WHERE name IN ('Manual Pay Clinic', 'Existing Trial Clinic')");

    const [org] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, site_key, plan, trial_ends_at)
       VALUES ('Manual Pay Clinic', ?, 'trial', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 14 DAY))`,
      [generateSiteKey()],
    );
    orgId = org.insertId;
    const [kept] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, site_key, plan, trial_ends_at)
       VALUES ('Existing Trial Clinic', ?, 'trial', '2031-04-01 00:00:00')`,
      [generateSiteKey()],
    );
    const ownerHash = await hashPassword('OwnerManualPassw0rd!26x');
    const adminHash = await hashPassword('AdminManualPassw0rd!26x');
    await pool.query(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?), (NULL, ?, ?, ?)',
      [orgId, 'owner.manual@apextest.local', ownerHash, 'owner', 'admin.manual@apextest.local', adminHash, 'admin'],
    );
    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger });
    const ownerLogin = await request(app).post('/api/auth/login').send({
      email: 'owner.manual@apextest.local',
      password: 'OwnerManualPassw0rd!26x',
    });
    const adminLogin = await request(app).post('/api/auth/login').send({
      email: 'admin.manual@apextest.local',
      password: 'AdminManualPassw0rd!26x',
    });
    expect(ownerLogin.status).toBe(200);
    expect(adminLogin.status).toBe(200);
    ownerCookie = cookie(ownerLogin);
    adminCookie = cookie(adminLogin);
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT trial_ends_at FROM organizations WHERE id = ?',
      [kept.insertId],
    );
    existingTrialEnds = rows[0]?.trial_ends_at as Date;
  }, 60_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(
        "UPDATE manual_payment_methods SET enabled = 0, instructions = '' WHERE method_key = 'jazzcash'",
      );
      await pool.query(
        "UPDATE regional_prices SET amount_minor = 600000, is_placeholder = 1, label = 'Pakistan' WHERE region_code = 'pk'",
      );
      await pool.end();
    }
    await fs.rm(receiptDir, { recursive: true, force: true });
  });

  it('publishes seeded regions and lets the admin replace a placeholder', async () => {
    const plans = await request(app).get('/api/public/plans');
    expect(plans.status).toBe(200);
    const regions = plans.body.regions as Array<Record<string, unknown>>;
    const usd = regions.find((region) => region.code === 'us');
    const pkr = regions.find((region) => region.code === 'pk');
    expect(usd).toMatchObject({ currency: 'USD', amountMinor: 2000, placeholder: false });
    expect(pkr).toMatchObject({ currency: 'PKR', placeholder: true });

    const saved = await request(app)
      .patch('/api/admin/regional-prices/pk')
      .set('Cookie', adminCookie)
      .send({ amountMinor: 550000, currency: 'PKR', label: 'Pakistan' });
    expect(saved.status).toBe(200);
    expect(saved.body.region).toMatchObject({ amountMinor: 550000, placeholder: false });

    const ownerDenied = await request(app)
      .patch('/api/admin/regional-prices/pk')
      .set('Cookie', ownerCookie)
      .send({ amountMinor: 1 });
    expect(ownerDenied.status).toBe(403);
  });

  it('accepts a manual payment only after instructions exist, then extends paid_until on confirm', async () => {
    const blocked = await request(app)
      .post(`/api/organizations/${orgId}/billing/manual`)
      .set('Cookie', ownerCookie)
      .send({ regionCode: 'pk', methodKey: 'jazzcash', reference: 'JC10001' });
    expect(blocked.status).toBe(409);

    const enabled = await request(app)
      .patch('/api/admin/payment-methods/jazzcash')
      .set('Cookie', adminCookie)
      .send({
        label: 'JazzCash',
        instructions: 'Send to the JazzCash wallet listed by the operator.',
        enabled: true,
        regionCodes: ['pk'],
      });
    expect(enabled.status).toBe(200);

    const summary = await request(app).get(`/api/organizations/${orgId}/billing`).set('Cookie', ownerCookie);
    expect(summary.status).toBe(200);
    const methods = summary.body.manualMethods as Array<{ key: string; instructions: string }>;
    expect(methods.some((method) => method.key === 'jazzcash' && method.instructions.includes('JazzCash'))).toBe(true);
    expect(methods.some((method) => method.key === 'easypaisa')).toBe(false);

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ).toString('base64');
    const submitted = await request(app)
      .post(`/api/organizations/${orgId}/billing/manual`)
      .set('Cookie', ownerCookie)
      .send({
        regionCode: 'pk',
        methodKey: 'jazzcash',
        reference: 'JC10001',
        receipt: { contentType: 'image/png', dataBase64: tinyPng },
      });
    expect(submitted.status).toBe(201);

    const duplicate = await request(app)
      .post(`/api/organizations/${orgId}/billing/manual`)
      .set('Cookie', ownerCookie)
      .send({ regionCode: 'pk', methodKey: 'jazzcash', reference: 'JC10002' });
    expect(duplicate.status).toBe(409);

    const pending = await request(app).get('/api/admin/manual-payments?status=pending').set('Cookie', adminCookie);
    expect(pending.status).toBe(200);
    const row = (pending.body.payments as Array<{ id: number; orderId: string; reference: string }>).find(
      (payment) => payment.orderId === submitted.body.payment.orderId,
    );
    expect(row?.reference).toBe('JC10001');
    const receipt = await request(app)
      .get(`/api/admin/manual-payments/${row?.id}/receipt`)
      .set('Cookie', adminCookie);
    expect(receipt.status).toBe(200);
    expect(receipt.headers['content-type']).toMatch(/image\/png/);

    const rejectedFirst = await request(app)
      .post(`/api/admin/manual-payments/${row?.id}/reject`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Reference does not match the wallet.' });
    expect(rejectedFirst.status).toBe(200);
    const [planAfterReject] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT plan, paid_until FROM organizations WHERE id = ?',
      [orgId],
    );
    expect(planAfterReject[0]?.plan).toBe('trial');
    expect(planAfterReject[0]?.paid_until).toBeNull();

    const again = await request(app)
      .post(`/api/organizations/${orgId}/billing/manual`)
      .set('Cookie', ownerCookie)
      .send({ regionCode: 'pk', methodKey: 'jazzcash', reference: 'JC10002' });
    expect(again.status).toBe(201);
    const waiting = await request(app).get('/api/admin/manual-payments?status=pending').set('Cookie', adminCookie);
    const second = (waiting.body.payments as Array<{ id: number; orderId: string }>).find(
      (payment) => payment.orderId === again.body.payment.orderId,
    );
    const confirmed = await request(app)
      .post(`/api/admin/manual-payments/${second?.id}/confirm`)
      .set('Cookie', adminCookie)
      .send({});
    expect(confirmed.status).toBe(200);
    const [planAfter] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT plan, paid_until, TIMESTAMPDIFF(DAY, UTC_TIMESTAMP(), paid_until) AS days_left FROM organizations WHERE id = ?',
      [orgId],
    );
    expect(planAfter[0]?.plan).toBe('full');
    expect(Number(planAfter[0]?.days_left)).toBeGreaterThan(27);
    expect(Number(planAfter[0]?.days_left)).toBeLessThan(32);
  });

  it('leaves an existing trial end date untouched', async () => {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT trial_ends_at FROM organizations WHERE name = 'Existing Trial Clinic'",
    );
    expect(new Date(rows[0]?.trial_ends_at as Date).toISOString()).toBe(new Date(existingTrialEnds).toISOString());
  });

  it('imports valid CSV rows, skips duplicates, and records setup help', async () => {
    await pool.query('INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)', [
      orgId,
      'Existing',
      'Patient',
      '971501110000',
    ]);
    const csv = [
      'name,phone,email,dob,notes',
      'Layla Rahman,+971501112233,layla.manual@example.com,1990-04-12,Morning',
      'Existing Patient,+971501110000,existing.manual@example.com,1980-01-01,',
      'Only,bad-phone,,,',
    ].join('\n');
    const preview = await request(app)
      .post(`/api/organizations/${orgId}/patients/import/preview`)
      .set('Cookie', ownerCookie)
      .send({ csv });
    expect(preview.status).toBe(200);
    expect(preview.body.preview.readyCount).toBe(1);
    expect(preview.body.preview.duplicateCount).toBe(1);
    expect(preview.body.preview.errorCount).toBe(1);

    const template = await request(app)
      .get(`/api/organizations/${orgId}/patients/import-template`)
      .set('Cookie', ownerCookie);
    expect(template.status).toBe(200);
    expect(template.text).toBe('name,phone,email,dob,notes\n');
    expect(template.headers['content-disposition']).toMatch(/patients-template.csv/);

    const imported = await request(app)
      .post(`/api/organizations/${orgId}/patients/import`)
      .set('Cookie', ownerCookie)
      .send({ csv, mapping: preview.body.preview.mapping });
    expect(imported.status).toBe(201);
    expect(imported.body.imported).toBe(1);
    const [patients] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT first_name, last_name, date_of_birth FROM patients WHERE organization_id = ? AND phone = ?',
      [orgId, '971501112233'],
    );
    expect(patients[0]?.first_name).toBe('Layla');
    const born = patients[0]?.date_of_birth;
    const bornText = born instanceof Date ? born.toISOString().slice(0, 10) : String(born).slice(0, 10);
    expect(bornText).toBe('1990-04-12');

    const help = await request(app)
      .post(`/api/organizations/${orgId}/setup-help`)
      .set('Cookie', ownerCookie)
      .send({ note: 'Please import our old list.' });
    expect(help.status).toBe(201);
    const again = await request(app)
      .post(`/api/organizations/${orgId}/setup-help`)
      .set('Cookie', ownerCookie)
      .send({ note: 'Second note' });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    const listed = await request(app).get('/api/admin/setup-help').set('Cookie', adminCookie);
    expect(listed.status).toBe(200);
    expect(
      (listed.body.requests as Array<{ organizationName: string; note: string | null }>).some(
        (row) => row.organizationName === 'Manual Pay Clinic' && row.note === 'Please import our old list.',
      ),
    ).toBe(true);
  });
});
