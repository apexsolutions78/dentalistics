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
import type { Logger } from '../src/logger';
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

describe.skipIf(testHost === undefined || testHost === '')(
  'M5 acceptance: website lead capture',
  () => {
    let cfg: DbConfig;
    let pool: mysql.Pool;
    let app: Express;
    let logger: Logger & { entries: CapturedLog[] };

    let orgAId: number;
    let orgBId: number;
    let orgDisabledId: number;
    let orgNoKeyId: number;
    let orgRateId: number;

    const keyA = generateSiteKey();
    const keyB = generateSiteKey();
    const keyDisabled = generateSiteKey();
    const keyRate = generateSiteKey();

    const ownerAEmail = 'owner.webA@apextest.local';
    const ownerAPassword = 'OwnerWebAPassw0rd!26x';
    const ownerBEmail = 'owner.webB@apextest.local';
    const ownerBPassword = 'OwnerWebBPassw0rd!26x';
    const ownerNoKeyEmail = 'owner.webNK@apextest.local';
    const ownerNoKeyPassword = 'OwnerWebNKPassw0rd!26x';
    let ownerACookie: string;
    let ownerBCookie: string;
    let ownerNoKeyCookie: string;

    const PHONE_A = '+1 (555) 010-1001';
    const PHONE_A_CANONICAL = '15550101001';

    async function insertOrg(name: string, siteKey: string | null): Promise<number> {
      const [row] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name, site_key) VALUES (?, ?)',
        [name, siteKey],
      );
      return row.insertId;
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
      await pool.query('DELETE FROM appointments');
      await pool.query('DELETE FROM communication_messages');
      await pool.query('DELETE FROM lead_activities');
      await pool.query('DELETE FROM leads');
      await pool.query('DELETE FROM patients');
      await pool.query('DELETE FROM users');
      await pool.query('DELETE FROM organizations');

      orgAId = await insertOrg('M5 Clinic A', keyA);
      orgBId = await insertOrg('M5 Clinic B', keyB);
      orgDisabledId = await insertOrg('M5 Clinic Disabled', keyDisabled);
      await pool.query("UPDATE organizations SET status = 'disabled' WHERE id = ?", [
        orgDisabledId,
      ]);
      orgNoKeyId = await insertOrg('M5 Clinic NoKey', null);
      orgRateId = await insertOrg('M5 Clinic Rate', keyRate);

      async function insertOwner(email: string, password: string, organizationId: number) {
        const hash = await hashPassword(password);
        await pool.query(
          'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
          [organizationId, email, hash, 'owner'],
        );
      }
      await insertOwner(ownerAEmail, ownerAPassword, orgAId);
      await insertOwner(ownerBEmail, ownerBPassword, orgBId);
      await insertOwner(ownerNoKeyEmail, ownerNoKeyPassword, orgNoKeyId);

      logger = captureLogger();
      app = createApp({ db: pool, logger });

      const loginA = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerAEmail, password: ownerAPassword });
      ownerACookie = cookie(loginA);
      expect(loginA.status).toBe(200);
      const loginB = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerBEmail, password: ownerBPassword });
      ownerBCookie = cookie(loginB);
      expect(loginB.status).toBe(200);
      const loginNoKey = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerNoKeyEmail, password: ownerNoKeyPassword });
      ownerNoKeyCookie = cookie(loginNoKey);
      expect(loginNoKey.status).toBe(200);
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.end();
      }
    });

    function postLead(
      target: Express,
      siteKey: string | undefined,
      body: unknown,
    ): request.Test {
      let req = request(target).post('/api/public/leads');
      if (siteKey !== undefined) {
        req = req.set('X-Site-Key', siteKey);
      }
      return req.send(body as object);
    }

    let validLeadId = 0;

    it('creates a website lead with a valid site key (tenant identified from key)', async () => {
      const res = await postLead(app, keyA, {
        firstName: 'Vera',
        lastName: 'Website',
        phone: PHONE_A,
        email: 'vera@example.test',
        requestedService: 'Whitening',
        notes: 'Asked about evening appointments',
      });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body)).toEqual(['leadId']);
      validLeadId = res.body.leadId;
      expect(Number.isInteger(validLeadId)).toBe(true);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT * FROM leads WHERE id = ?',
        [validLeadId],
      );
      const lead = rows[0] as mysql.RowDataPacket | undefined;
      expect(lead).toBeDefined();
      expect(lead?.organization_id).toBe(orgAId);
      expect(lead?.source).toBe('WEBSITE');
      expect(lead?.status).toBe('NEW');
      expect(lead?.created_by).toBeNull();
      expect(lead?.phone).toBe(PHONE_A_CANONICAL);
      expect(lead?.assigned_user_id).toBeNull();
    });

    it('fires the automation trigger without logging sensitive data', async () => {
      const triggers = logger.entries.filter(
        (e) => e.message === 'automation trigger: lead_created',
      );
      expect(triggers.length).toBeGreaterThanOrEqual(1);
      const last = triggers[triggers.length - 1];
      expect(last?.fields).toMatchObject({
        organizationId: orgAId,
        leadId: validLeadId,
        source: 'WEBSITE',
      });
      const serialized = JSON.stringify(triggers);
      expect(serialized).not.toContain(PHONE_A);
      expect(serialized).not.toContain(PHONE_A_CANONICAL);
      expect(serialized).not.toContain('vera@example.test');

      const created = logger.entries.filter((e) => e.message === 'public lead created');
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(created)).not.toContain(PHONE_A_CANONICAL);
    });

    it('records lead activity with no actor user', async () => {
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT actor_user_id, action FROM lead_activities WHERE lead_id = ? AND action = 'created'",
        [validLeadId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_user_id).toBeNull();
    });

    it('rejects invalid leads', async () => {
      const missingName = await postLead(app, keyA, { lastName: 'X', phone: '15550101002' });
      expect(missingName.status).toBe(400);
      expect(missingName.body.error.code).toBe('validation_failed');

      const badPhone = await postLead(app, keyA, { firstName: 'A', lastName: 'B', phone: 'abc' });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body.error.code).toBe('validation_failed');

      const arrayBody = await postLead(app, keyA, []);
      expect(arrayBody.status).toBe(400);
      expect(arrayBody.body.error.code).toBe('validation_failed');

      const spoofStatus = await postLead(app, keyA, {
        firstName: 'A',
        lastName: 'B',
        phone: '15550101003',
        status: 'CLOSED',
      });
      expect(spoofStatus.status).toBe(400);
      expect(spoofStatus.body.error.code).toBe('validation_failed');

      const spoofOrg = await postLead(app, keyA, {
        firstName: 'A',
        lastName: 'B',
        phone: '15550101004',
        organizationId: orgBId,
      });
      expect(spoofOrg.status).toBe(400);
      expect(spoofOrg.body.error.code).toBe('validation_failed');
    });

    it('requires a valid active-clinic site key (authentication)', async () => {
      const noKey = await postLead(app, undefined, {
        firstName: 'A',
        lastName: 'B',
        phone: '15550101005',
      });
      expect(noKey.status).toBe(401);
      expect(noKey.body.error.code).toBe('invalid_site_key');

      const wrongKey = await postLead(app, 'f'.repeat(64), {
        firstName: 'A',
        lastName: 'B',
        phone: '15550101006',
      });
      expect(wrongKey.status).toBe(401);
      expect(wrongKey.body.error.code).toBe('invalid_site_key');

      const disabledOrg = await postLead(app, keyDisabled, {
        firstName: 'A',
        lastName: 'B',
        phone: '15550101007',
      });
      expect(disabledOrg.status).toBe(401);
      expect(disabledOrg.body.error.code).toBe('invalid_site_key');
    });

    it('rejects a duplicate active lead for the same phone in the same clinic', async () => {
      const res = await postLead(app, keyA, {
        firstName: 'Vera',
        lastName: 'Website',
        phone: '15550101001',
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('duplicate_lead');

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS c FROM leads WHERE organization_id = ? AND phone = ?',
        [orgAId, PHONE_A_CANONICAL],
      );
      expect(Number(rows[0]?.c)).toBe(1);
    });

    it('scopes duplicate detection per clinic (same phone allowed for another tenant)', async () => {
      const res = await postLead(app, keyB, {
        firstName: 'Dup',
        lastName: 'Cross',
        phone: PHONE_A,
      });
      expect(res.status).toBe(201);
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT organization_id FROM leads WHERE id = ?',
        [res.body.leadId],
      );
      expect(rows[0]?.organization_id).toBe(orgBId);
    });

    it('rate limits by site key then by ip', async () => {
      const rateLogger = captureLogger();
      const rateApp = createApp({
        db: pool,
        logger: rateLogger,
        publicLeadRate: { perIp: 5, perKey: 3, windowMs: 60_000 },
      });
      const body = { firstName: 'Spam', lastName: 'Bot', phone: '15550109999' };

      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await postLead(rateApp, keyRate, body);
        statuses.push(res.status);
      }
      expect(statuses).toEqual([201, 409, 409, 429, 429, 429]);

      const limited = rateLogger.entries.filter((e) => e.message === 'public lead rate limited');
      expect(limited.length).toBe(3);
      expect(limited[0]?.fields?.scope).toBe('key');
      expect(limited[1]?.fields?.scope).toBe('key');
      expect(limited[2]?.fields?.scope).toBe('ip');

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS c FROM leads WHERE organization_id = ? AND phone = ?',
        [orgRateId, '15550109999'],
      );
      expect(Number(rows[0]?.c)).toBe(1);
    });

    it('lets the owner retrieve a stable site key and hides other clinics', async () => {
      const resA = await request(app)
        .get(`/api/organizations/${orgAId}`)
        .set('Cookie', ownerACookie);
      expect(resA.status).toBe(200);
      expect(resA.body.organization.siteKey).toBe(keyA);

      const resB = await request(app)
        .get(`/api/organizations/${orgBId}`)
        .set('Cookie', ownerACookie);
      expect(resB.status).toBe(404);

      const resOwnB = await request(app)
        .get(`/api/organizations/${orgBId}`)
        .set('Cookie', ownerBCookie);
      expect(resOwnB.status).toBe(200);
      expect(resOwnB.body.organization.siteKey).toBe(keyB);

      const resNoKey1 = await request(app)
        .get(`/api/organizations/${orgNoKeyId}`)
        .set('Cookie', ownerNoKeyCookie);
      expect(resNoKey1.status).toBe(200);
      const generated = resNoKey1.body.organization.siteKey;
      expect(typeof generated).toBe('string');
      expect(generated).toMatch(/^[0-9a-f]{64}$/);

      const resNoKey2 = await request(app)
        .get(`/api/organizations/${orgNoKeyId}`)
        .set('Cookie', ownerNoKeyCookie);
      expect(resNoKey2.body.organization.siteKey).toBe(generated);

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT site_key FROM organizations WHERE id = ?',
        [orgNoKeyId],
      );
      expect(rows[0]?.site_key).toBe(generated);
    });
  },
);
