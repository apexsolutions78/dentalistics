import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAYMENT_GATEWAY_META_KEY } from '../src/payments/gatewayConfig';
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

describe.skipIf(testHost === undefined || testHost === '')('Phase B: payments and gateway', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let adminCookie: string;
  let orgAId: number;
  let orgBId: number;
  let orgAOrder: string;

  const ownerEmail = 'owner.pay@apextest.local';
  const ownerPassword = 'OwnerPayPassw0rd!26x';
  const recEmail = 'rec.pay@apextest.local';
  const recPassword = 'RecPayPassw0rd!26x';
  const ownerBEmail = 'owner.payb@apextest.local';
  const ownerBPassword = 'OwnerPayBPassw0rd!26x';
  const adminEmail = 'admin.pay@apextest.local';
  const adminPassword = 'AdminPayPassw0rd!26x';

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      `INSERT INTO organizations (name, site_key, plan, trial_ends_at)
       VALUES (?, ?, 'trial', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 DAY))`,
      [name, generateSiteKey()],
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

  function billingPath(org: number, suffix = ''): string {
    return `/api/organizations/${org}/billing${suffix}`;
  }

  async function setGateway(body: Record<string, unknown>, ck = adminCookie): Promise<request.Response> {
    return request(app).patch('/api/admin/payment-gateway').set('Cookie', ck).send(body);
  }

  async function orgPlan(orgId: number): Promise<{ plan: string; trialEnds: Date | null }> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT plan, trial_ends_at FROM organizations WHERE id = ?',
      [orgId],
    );
    const row = rows[0] as mysql.RowDataPacket;
    return { plan: row.plan as string, trialEnds: row.trial_ends_at as Date | null };
  }

  async function paymentsFor(orgId: number): Promise<Array<Record<string, unknown>>> {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      'SELECT order_id, status, amount_usd_cents, currency, provider FROM payments WHERE organization_id = ? ORDER BY id',
      [orgId],
    );
    return rows as Array<Record<string, unknown>>;
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
    await pool.query(
      "DELETE al FROM audit_logs al JOIN organizations o ON o.id = al.organization_id WHERE o.name LIKE 'Pay Test%'",
    );
    await pool.query(
      "DELETE FROM payments WHERE organization_id IN (SELECT id FROM organizations WHERE name LIKE 'Pay Test%')",
    );
    await pool.query(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%.pay@apextest.local' OR email LIKE '%.payb@apextest.local')",
    );
    await pool.query(
      "DELETE FROM users WHERE email LIKE '%.pay@apextest.local' OR email LIKE '%.payb@apextest.local'",
    );
    await pool.query("DELETE FROM organizations WHERE name LIKE 'Pay Test%'");
    await pool.query('DELETE FROM app_meta WHERE meta_key = ?', [PAYMENT_GATEWAY_META_KEY]);

    orgAId = await insertOrg('Pay Test Dental A');
    orgBId = await insertOrg('Pay Test Dental B');
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
    if (pool !== undefined) {
      await pool.end();
    }
  });

  it('serves the billing summary with USD pricing and enforces access', async () => {
    const unauth = await request(app).get(billingPath(orgAId));
    expect(unauth.status).toBe(401);

    const forbidden = await request(app).get(billingPath(orgAId)).set('Cookie', recCookie);
    expect(forbidden.status).toBe(403);

    const foreign = await request(app).get(billingPath(orgAId)).set('Cookie', ownerBCookie);
    expect(foreign.status).toBe(404);

    const res = await request(app).get(billingPath(orgAId)).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: orgAId, plan: 'trial' });
    expect(res.body.price).toEqual({
      amountUsdCents: 2000,
      currency: 'USD',
      interval: 'month',
      name: 'Full Plan',
    });
    expect(res.body.gateway.enabled).toBe(false);
    expect(res.body.payments).toEqual([]);
  });

  it('blocks checkout while the gateway is switched off', async () => {
    const res = await request(app).post(billingPath(orgAId, '/checkout')).set('Cookie', ownerCookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('gateway_disabled');
    expect(await paymentsFor(orgAId)).toEqual([]);
  });

  it('reports the gateway as red by default and only platform admins can manage it', async () => {
    const ownerAttempt = await request(app)
      .get('/api/admin/payment-gateway')
      .set('Cookie', ownerCookie);
    expect(ownerAttempt.status).toBe(403);

    const res = await request(app).get('/api/admin/payment-gateway').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.gateway).toMatchObject({ enabled: false, provider: 'assanpay', state: 'red' });
    expect(res.body.gateway.reasons).toEqual(
      expect.arrayContaining([
        'API base URL is not set',
        'Merchant ID is not set',
        'Return URL base is not set',
        'Gateway is switched off',
      ]),
    );
  });

  it('validates gateway configuration updates', async () => {
    const badProvider = await setGateway({ provider: 'stripe' });
    expect(badProvider.status).toBe(400);

    const badUrl = await setGateway({ baseUrl: 'not-a-url' });
    expect(badUrl.status).toBe(400);

    const badEnabled = await setGateway({ enabled: 'yes' });
    expect(badEnabled.status).toBe(400);

    const assanpayComplete = await setGateway({
      baseUrl: 'https://api.assanpay.test',
      merchantId: 'M-123',
      returnUrlBase: 'https://dentalistics.example',
    });
    expect(assanpayComplete.status).toBe(200);
    expect(assanpayComplete.body.gateway).toMatchObject({ state: 'red', enabled: false });
    expect(assanpayComplete.body.gateway.reasons).toEqual(['Gateway is switched off']);

    const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action FROM audit_logs WHERE action = 'payment_gateway_config_updated'",
    );
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it('switches the gateway to the mock provider and reports it green', async () => {
    const res = await setGateway({ enabled: true, provider: 'mock', storeName: 'Pay Test Store' });
    expect(res.status).toBe(200);
    expect(res.body.gateway).toMatchObject({ enabled: true, provider: 'mock', state: 'green' });

    const probe = await request(app)
      .post('/api/admin/payment-gateway/test')
      .set('Cookie', adminCookie);
    expect(probe.status).toBe(200);
    expect(probe.body.result).toMatchObject({ ok: true });
  });

  it('creates a pending checkout with a gateway-safe order id', async () => {
    const forbidden = await request(app)
      .post(billingPath(orgAId, '/checkout'))
      .set('Cookie', recCookie);
    expect(forbidden.status).toBe(403);

    const res = await request(app).post(billingPath(orgAId, '/checkout')).set('Cookie', ownerCookie);
    expect(res.status).toBe(201);
    const payment = res.body.payment as Record<string, unknown>;
    orgAOrder = payment.orderId as string;
    expect(payment).toMatchObject({
      amountUsdCents: 2000,
      currency: 'USD',
      provider: 'mock',
      status: 'pending',
      checkoutUrl: `/billing/mock/${orgAOrder}`,
    });
    expect(orgAOrder).toMatch(/^[A-Za-z0-9]{1,20}$/);

    const rows = await paymentsFor(orgAId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ order_id: orgAOrder, status: 'PENDING' });
  });

  it('supersedes the previous pending payment when a new checkout starts', async () => {
    const res = await request(app).post(billingPath(orgAId, '/checkout')).set('Cookie', ownerCookie);
    expect(res.status).toBe(201);
    const secondOrder = res.body.payment.orderId as string;
    expect(secondOrder).not.toBe(orgAOrder);
    orgAOrder = secondOrder;

    const rows = await paymentsFor(orgAId);
    expect(rows).toHaveLength(2);
    const statuses = rows.map((row) => row.status);
    expect(statuses).toContain('CANCELLED');
    expect(statuses.filter((status) => status === 'PENDING')).toHaveLength(1);
  });

  it('reports pending until the payment is completed', async () => {
    const res = await request(app)
      .get(billingPath(orgAId, `/payments/${orgAOrder}/status`))
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ orderId: orgAOrder, status: 'pending', plan: 'trial' });

    const foreign = await request(app)
      .get(billingPath(orgAId, `/payments/${orgAOrder}/status`))
      .set('Cookie', ownerBCookie);
    expect(foreign.status).toBe(404);
  });

  it('activates the Full Plan when the mock payment completes', async () => {
    const res = await request(app)
      .post(billingPath(orgAId, `/payments/${orgAOrder}/mock-complete`))
      .set('Cookie', ownerCookie)
      .send({ result: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'paid', plan: 'full' });

    const org = await orgPlan(orgAId);
    expect(org.plan).toBe('full');
    expect(org.trialEnds).toBeNull();

    const [paidAudit] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'payment_completed'",
      [orgAId],
    );
    expect((paidAudit[0] as mysql.RowDataPacket).n).toBe(1);

    const [activationAudit] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'trial_activated'",
      [orgAId],
    );
    expect((activationAudit[0] as mysql.RowDataPacket).n).toBe(1);

    const again = await request(app)
      .get(billingPath(orgAId, `/payments/${orgAOrder}/status`))
      .set('Cookie', ownerCookie);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'paid', plan: 'full' });

    const [paidAuditAgain] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE organization_id = ? AND action = 'payment_completed'",
      [orgAId],
    );
    expect((paidAuditAgain[0] as mysql.RowDataPacket).n).toBe(1);

    const checkout = await request(app)
      .post(billingPath(orgAId, '/checkout'))
      .set('Cookie', ownerCookie);
    expect(checkout.status).toBe(409);
    expect(checkout.body.error.code).toBe('already_active');
  });

  it('records a failed mock payment without activating the plan', async () => {
    const checkout = await request(app)
      .post(billingPath(orgBId, '/checkout'))
      .set('Cookie', ownerBCookie);
    expect(checkout.status).toBe(201);
    const order = checkout.body.payment.orderId as string;

    const invalid = await request(app)
      .post(billingPath(orgBId, `/payments/${order}/mock-complete`))
      .set('Cookie', ownerBCookie)
      .send({ result: 'nope' });
    expect(invalid.status).toBe(400);

    const res = await request(app)
      .post(billingPath(orgBId, `/payments/${order}/mock-complete`))
      .set('Cookie', ownerBCookie)
      .send({ result: 'failed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'failed', plan: 'trial' });

    const org = await orgPlan(orgBId);
    expect(org.plan).toBe('trial');
    expect(org.trialEnds).not.toBeNull();
  });

  it('refuses mock completion once a real provider is selected', async () => {
    const checkout = await request(app)
      .post(billingPath(orgBId, '/checkout'))
      .set('Cookie', ownerBCookie);
    expect(checkout.status).toBe(201);
    const order = checkout.body.payment.orderId as string;

    const switchProvider = await setGateway({ provider: 'assanpay' });
    expect(switchProvider.status).toBe(200);

    const res = await request(app)
      .post(billingPath(orgBId, `/payments/${order}/mock-complete`))
      .set('Cookie', ownerBCookie)
      .send({ result: 'paid' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('mock_disabled');

    await setGateway({ provider: 'mock' });
  });

  it('lets an expired trial clinic still check out while other writes stay locked', async () => {
    await pool.query(
      `UPDATE organizations SET trial_ends_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE)
       WHERE id = ? AND plan = 'trial'`,
      [orgBId],
    );

    const lockedWrite = await request(app)
      .patch(`/api/organizations/${orgBId}`)
      .set('Cookie', ownerBCookie)
      .send({ timezone: 'UTC' });
    expect(lockedWrite.status).toBe(403);
    expect(lockedWrite.body.error.code).toBe('trial_expired');

    const checkout = await request(app)
      .post(billingPath(orgBId, '/checkout'))
      .set('Cookie', ownerBCookie);
    expect(checkout.status).toBe(201);
    expect(checkout.body.payment.status).toBe('pending');

    const summary = await request(app)
      .get(billingPath(orgBId))
      .set('Cookie', ownerBCookie);
    expect(summary.status).toBe(200);
    expect(summary.body.organization.plan).toBe('trial');
  });
});
