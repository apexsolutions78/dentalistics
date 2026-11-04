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

describe.skipIf(testHost === undefined || testHost === '')('clinic patient billing', () => {
  let pool: mysql.Pool;
  let app: Express;
  let ownerCookie: string;
  let recCookie: string;
  let ownerBCookie: string;
  let orgId: number;
  let orgBId: number;
  let patientId: number;

  const ownerEmail = 'owner.pbill@apextest.local';
  const ownerPassword = 'OwnerPbillPassw0rd!26x';
  const recEmail = 'rec.pbill@apextest.local';
  const recPassword = 'RecPbillPassw0rd!26x';
  const ownerBEmail = 'owner.pbillb@apextest.local';
  const ownerBPassword = 'OwnerPbillBPassw0rd!26x';

  async function insertOrg(name: string): Promise<number> {
    const [row] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key, timezone, phone, email, address) VALUES (?, ?, ?, ?, ?, ?)',
      [name, generateSiteKey(), 'Asia/Dubai', '+9714000000', 'desk@clinic.test', '12 Marina Walk'],
    );
    return row.insertId;
  }

  async function insertUser(organizationId: number, email: string, password: string, role: string): Promise<void> {
    const hash = await hashPassword(password);
    await pool.query('INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      organizationId,
      email,
      hash,
      role,
    ]);
  }

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return cookie(res);
  }

  async function wipe(): Promise<void> {
    const statements = [
      'DELETE FROM patient_payments',
      'DELETE FROM patient_invoices',
      'DELETE FROM clinic_expenses',
      'DELETE FROM clinic_billing_settings',
      'DELETE FROM call_events',
      'DELETE FROM webhook_events',
      'DELETE FROM error_events',
      'DELETE FROM review_requests',
      'DELETE FROM recall_messages',
      'DELETE FROM recalls',
      'DELETE FROM no_show_messages',
      'DELETE FROM no_show_cases',
      'DELETE FROM appointment_reminders',
      'DELETE FROM lead_slot_suggestions',
      'DELETE FROM appointments',
      'DELETE FROM communication_messages',
      'DELETE FROM lead_activities',
      'DELETE FROM leads',
      'DELETE FROM patients',
      'DELETE FROM sessions',
      'DELETE FROM password_reset_tokens',
      'DELETE FROM payments',
      'DELETE FROM doctors',
      'DELETE FROM users',
      'DELETE FROM organizations',
      'DELETE FROM organization_settings',
      'DELETE FROM audit_logs',
    ];
    for (const statement of statements) {
      await pool.query(statement);
    }
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
    const migrationResult = await runMigrations(cfg, path.resolve(process.cwd(), 'migrations'));
    expect(migrationResult.applied.length + migrationResult.skipped.length).toBeGreaterThan(0);

    pool = createPool(cfg);
    await wipe();
    orgId = await insertOrg('Patient Billing Clinic');
    orgBId = await insertOrg('Patient Billing Clinic B');
    await insertUser(orgId, ownerEmail, ownerPassword, 'owner');
    await insertUser(orgId, recEmail, recPassword, 'receptionist');
    await insertUser(orgBId, ownerBEmail, ownerBPassword, 'owner');
    const [patient] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgId, 'Layla', 'Rahman', '+971500000111'],
    );
    patientId = patient.insertId;

    const logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({ db: pool, logger });
    ownerCookie = await login(ownerEmail, ownerPassword);
    recCookie = await login(recEmail, recPassword);
    ownerBCookie = await login(ownerBEmail, ownerBPassword);
  }, 60_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await wipe();
      await pool.end();
    }
  });

  it('requires a signed-in clinic member', async () => {
    const res = await request(app).get(`/api/organizations/${orgId}/patient-billing/invoices`);
    expect(res.status).toBe(401);
  });

  it('issues numbered invoices, takes a partial payment and a refund, and keeps the other clinic separate', async () => {
    const hidden = await request(app)
      .get(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', ownerBCookie);
    expect(hidden.status).toBe(404);

    const denied = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', recCookie)
      .send({ patientId, lines: [{ description: 'Cleaning', quantity: 1, unitPriceCents: 1000 }] });
    expect(denied.status).toBe(403);

    const listed = await request(app)
      .get(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', recCookie);
    expect(listed.status).toBe(200);
    expect(listed.body.invoices).toEqual([]);

    const created = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', ownerCookie)
      .send({
        patientId,
        notes: 'Hygiene visit',
        lines: [
          { description: 'Scale and polish', quantity: 2, unitPriceCents: 5000, discountCents: 1000, taxPercent: 5 },
        ],
      });
    expect(created.status).toBe(201);
    expect(created.body.invoice).toMatchObject({
      status: 'draft',
      currency: 'AED',
      taxLabel: 'VAT',
      number: null,
      subtotalCents: 10000,
      discountCents: 1000,
      taxCents: 450,
      totalCents: 9450,
      balanceCents: 0,
    });
    expect(created.body.invoice.letterhead).toMatchObject({
      name: 'Patient Billing Clinic',
      address: '12 Marina Walk',
    });
    const invoiceId = created.body.invoice.id as number;

    const tooSoon = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/payments`)
      .set('Cookie', ownerCookie)
      .send({ amountCents: 1000, method: 'cash', paidOn: '2026-11-04' });
    expect(tooSoon.status).toBe(400);

    const issued = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/issue`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(issued.status).toBe(200);
    expect(issued.body.invoice.number).toBe('INV-0001');
    expect(issued.body.invoice.status).toBe('issued');
    expect(issued.body.invoice.balanceCents).toBe(9450);

    const jazz = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/payments`)
      .set('Cookie', ownerCookie)
      .send({ amountCents: 4000, method: 'jazzcash', paidOn: '2026-11-04' });
    expect(jazz.status).toBe(400);

    const partial = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/payments`)
      .set('Cookie', ownerCookie)
      .send({ amountCents: 4000, method: 'card_terminal', paidOn: '2026-11-04', note: 'Terminal 2' });
    expect(partial.status).toBe(201);
    expect(partial.body.invoice.status).toBe('partially_paid');
    expect(partial.body.invoice.paidCents).toBe(4000);
    expect(partial.body.invoice.balanceCents).toBe(5450);

    const blockedVoid = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/void`)
      .set('Cookie', ownerCookie)
      .send({ reason: 'Entered in error' });
    expect(blockedVoid.status).toBe(409);
    expect(blockedVoid.body.error.code).toBe('invoice_has_payments');

    const refund = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/payments`)
      .set('Cookie', ownerCookie)
      .send({ amountCents: -1500, method: 'card_terminal', paidOn: '2026-11-05', note: 'Overcharge' });
    expect(refund.status).toBe(201);
    expect(refund.body.invoice.paidCents).toBe(2500);
    expect(refund.body.invoice.status).toBe('partially_paid');

    const second = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', ownerCookie)
      .send({
        patientId,
        lines: [{ description: 'Consultation', quantity: 1, unitPriceCents: 0, taxPercent: 0 }],
      });
    expect(second.status).toBe(201);
    const secondId = second.body.invoice.id as number;
    const secondIssued = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${secondId}/issue`)
      .set('Cookie', ownerCookie)
      .send({});
    expect(secondIssued.body.invoice.number).toBe('INV-0002');
    expect(secondIssued.body.invoice.status).toBe('paid');

    const [patientB] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO patients (organization_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)',
      [orgBId, 'Omar', 'Nasser', '+971500000222'],
    );
    const other = await request(app)
      .post(`/api/organizations/${orgBId}/patient-billing/invoices`)
      .set('Cookie', ownerBCookie)
      .send({
        patientId: patientB.insertId,
        lines: [{ description: 'Whitening', quantity: 1, unitPriceCents: 20000 }],
      });
    expect(other.status).toBe(201);
    const otherIssued = await request(app)
      .post(`/api/organizations/${orgBId}/patient-billing/invoices/${other.body.invoice.id}/issue`)
      .set('Cookie', ownerBCookie)
      .send({});
    expect(otherIssued.body.invoice.number).toBe('INV-0001');

    const balance = await request(app)
      .get(`/api/organizations/${orgId}/patient-billing/invoices?patientId=${patientId}`)
      .set('Cookie', ownerCookie);
    expect(balance.status).toBe(200);
    expect(balance.body.balance).toMatchObject({
      patientId,
      currency: 'AED',
      balanceCents: 6950,
    });

    const remove = await request(app)
      .delete(`/api/organizations/${orgId}/patients/${patientId}`)
      .set('Cookie', ownerCookie);
    expect(remove.status).toBe(409);
    expect(remove.body.error.code).toBe('patient_has_invoices');
  });

  it('accepts JazzCash only after the clinic currency is PKR', async () => {
    const switched = await request(app)
      .patch(`/api/organizations/${orgId}/patient-billing/settings`)
      .set('Cookie', ownerCookie)
      .send({ currency: 'PKR', taxLabel: 'Sales tax', invoicePrefix: 'PK' });
    expect(switched.status).toBe(200);
    expect(switched.body.settings.paymentMethods).toEqual(
      expect.arrayContaining(['jazzcash', 'easypaisa']),
    );

    const created = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices`)
      .set('Cookie', ownerCookie)
      .send({
        patientId,
        lines: [{ description: 'Filling', quantity: 1, unitPriceCents: 800000, taxPercent: 0 }],
      });
    expect(created.body.invoice.currency).toBe('PKR');
    const invoiceId = created.body.invoice.id as number;
    await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/issue`)
      .set('Cookie', ownerCookie)
      .send({});
    const paid = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/invoices/${invoiceId}/payments`)
      .set('Cookie', ownerCookie)
      .send({ amountCents: 800000, method: 'easypaisa', paidOn: new Date().toISOString().slice(0, 10) });
    expect(paid.status).toBe(201);
    expect(paid.body.invoice.status).toBe('paid');

    const recSettings = await request(app)
      .patch(`/api/organizations/${orgId}/patient-billing/settings`)
      .set('Cookie', recCookie)
      .send({ currency: 'AED' });
    expect(recSettings.status).toBe(403);
  });

  it('reports revenue, collections, expenses, profit, and the no-show rate, and exports csv', async () => {
    const reportsDenied = await request(app)
      .get(`/api/organizations/${orgId}/patient-billing/reports?from=2026-11-01&to=2026-11-30&groupBy=month`)
      .set('Cookie', recCookie);
    expect(reportsDenied.status).toBe(403);
    const expensesDenied = await request(app)
      .get(`/api/organizations/${orgId}/patient-billing/expenses`)
      .set('Cookie', recCookie);
    expect(expensesDenied.status).toBe(403);

    const today = new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO appointments (organization_id, patient_id, appointment_date, appointment_time, status)
       VALUES (?, ?, ?, '09:00:00', 'NO_SHOW'),
              (?, ?, ?, '10:00:00', 'COMPLETED'),
              (?, ?, ?, '11:00:00', 'CANCELLED')`,
      [orgId, patientId, today, orgId, patientId, today, orgId, patientId, today],
    );
    const expense = await request(app)
      .post(`/api/organizations/${orgId}/patient-billing/expenses`)
      .set('Cookie', ownerCookie)
      .send({ category: 'Supplies', amountCents: 2000, expenseDate: today, note: 'Gloves' });
    expect(expense.status).toBe(201);

    const report = await request(app)
      .get(
        `/api/organizations/${orgId}/patient-billing/reports?from=${today}&to=${today}&groupBy=month`,
      )
      .set('Cookie', ownerCookie);
    expect(report.status).toBe(200);
    expect(report.body.currency).toBe('PKR');
    expect(report.body.summary.paymentsCollectedCents).toBe(800000);
    expect(report.body.summary.expensesCents).toBe(2000);
    expect(report.body.summary.noShows).toBe(1);
    expect(report.body.summary.appointments).toBe(2);
    expect(report.body.summary.noShowRate).toBe(0.5);
    expect(report.body.summary.appointmentCounts.CANCELLED).toBe(1);
    const month = report.body.buckets[0];
    expect(month.profitCents).toBe(month.revenueCents - month.expensesCents);
    expect(month.revenueCents).toBe(800000);

    const aedInvoice = report.body.excluded as Array<{ currency: string; revenueCents: number }>;
    expect(aedInvoice.some((row) => row.currency === 'AED' && row.revenueCents === 9450)).toBe(true);

    const csv = await request(app)
      .get(
        `/api/organizations/${orgId}/patient-billing/reports.csv?from=${today}&to=${today}&groupBy=day`,
      )
      .set('Cookie', ownerCookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.startsWith('bucket,revenue_cents,')).toBe(true);
    expect(csv.text).toContain(today);
    expect(csv.text).toContain('800000');

    const [audits] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT action FROM audit_logs WHERE organization_id = ? AND action IN (
         'patient_invoice_created', 'patient_invoice_issued', 'patient_payment_recorded',
         'clinic_expense_created', 'patient_billing_settings_updated'
       )`,
      [orgId],
    );
    const actions = audits.map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'patient_invoice_created',
        'patient_invoice_issued',
        'patient_payment_recorded',
        'clinic_expense_created',
        'patient_billing_settings_updated',
      ]),
    );
  });
});
