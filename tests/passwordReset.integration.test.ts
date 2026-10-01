import 'dotenv/config';
import path from 'node:path';
import type { Express } from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { hashPassword } from '../src/auth/password';
import { hashResetToken } from '../src/auth/passwordReset';
import { createApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import { createLogger } from '../src/logger';
import type { Logger } from '../src/logger';
import { generateSiteKey } from '../src/security/siteKey';
import type { PasswordResetMailer } from '../src/mail/passwordResetMailer';

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

interface CapturedMail {
  to: string;
  link: string;
}

function captureMailer(captured: CapturedMail[]): PasswordResetMailer {
  return {
    async sendPasswordReset({ to, link }) {
      captured.push({ to, link });
      return { sent: true };
    },
  };
}

function tokenFromLink(link: string): string {
  const url = new URL(link);
  const token = url.searchParams.get('token');
  if (token === null) throw new Error(`No token in link: ${link}`);
  return token;
}

function lastToken(box: CapturedMail[]): string {
  const last = box[box.length - 1];
  expect(last).toBeDefined();
  return tokenFromLink(String(last?.link));
}

describe.skipIf(testHost === undefined || testHost === '')('F2 password reset flow', () => {
  let cfg: DbConfig;
  let pool: mysql.Pool;
  let logger: Logger;
  let app: Express;
  let rlApp: Express;
  let rateApp: Express;
  let ownerCookie: string;
  let orgId: number;
  let ownerUserId: number;

  const ownerEmail = 'owner.reset@apextest.local';
  const ownerPassword = 'OwnerResetPassw0rd!26x';
  const newPassword = 'BrandNewResetPassw0rd!26x';
  const unknownEmail = 'nobody.reset@apextest.local';

  const mainCaptured: CapturedMail[] = [];
  const rlCaptured: CapturedMail[] = [];

  const genericMessage =
    'If an account exists for that email, a password reset link has been sent.';

  async function requestReset(targetApp: Express, email: string): Promise<request.Response> {
    return request(targetApp).post('/api/auth/forgot-password').send({ email });
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
    await pool.query('DELETE FROM password_reset_tokens');
    await pool.query('DELETE FROM call_events');
    await pool.query('DELETE FROM webhook_events');
    await pool.query('DELETE FROM error_events');
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
    await pool.query('DELETE FROM sessions');
    await pool.query('DELETE FROM audit_logs');
    await pool.query('DELETE FROM users');
    await pool.query('DELETE FROM organizations');
    await pool.query('DELETE FROM organization_settings');
    await pool.query('DELETE FROM app_meta');

    const [org] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO organizations (name, site_key, timezone) VALUES (?, ?, ?)',
      ['Reset Clinic', generateSiteKey(), 'UTC'],
    );
    orgId = org.insertId;

    const hash = await hashPassword(ownerPassword);
    const [user] = await pool.query<mysql.ResultSetHeader>(
      'INSERT INTO users (organization_id, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [orgId, ownerEmail, hash, 'owner'],
    );
    ownerUserId = user.insertId;

    logger = createLogger({ level: 'error', write: () => undefined });
    app = createApp({
      db: pool,
      logger,
      resetBaseUrl: 'https://app.reset.test',
      passwordResetMailer: captureMailer(mainCaptured),
    });
    rlApp = createApp({
      db: pool,
      logger,
      resetBaseUrl: 'https://app.reset.test',
      passwordResetMailer: captureMailer(rlCaptured),
    });
    rateApp = createApp({
      db: pool,
      logger,
      resetBaseUrl: 'https://app.reset.test',
      passwordResetMailer: captureMailer([]),
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: ownerEmail, password: ownerPassword });
    expect(loginRes.status).toBe(200);
    ownerCookie = cookie(loginRes);
  }, 60_000);

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.end();
    }
  });

  describe('POST /api/auth/forgot-password', () => {
    it('answers unknown emails with the same generic 200 as known emails', async () => {
      const unknownRes = await requestReset(app, unknownEmail);
      expect(unknownRes.status).toBe(200);
      expect(unknownRes.body.message).toBe(genericMessage);

      const before = mainCaptured.length;
      const knownRes = await requestReset(app, ownerEmail);
      expect(knownRes.status).toBe(200);
      expect(knownRes.body.message).toBe(genericMessage);
      expect(mainCaptured.length).toBe(before + 1);
    });

    it('stores only a sha256 hash of the token with a future expiry', async () => {
      expect(mainCaptured.length).toBeGreaterThan(0);
      const last = mainCaptured[mainCaptured.length - 1];
      expect(last?.to).toBe(ownerEmail);
      expect(last?.link.startsWith('https://app.reset.test/reset-password?token=')).toBe(true);

      const token = tokenFromLink(String(last?.link));
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        [ownerUserId],
      );
      const row = rows[0];
      expect(row).toBeDefined();
      expect(row?.token_hash).toBe(hashResetToken(token));
      expect(row?.token_hash).not.toBe(token);
      expect(row?.used_at).toBeNull();
      expect(new Date(String(row?.expires_at)).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects an empty email with a validation error', async () => {
      const res = await request(app).post('/api/auth/forgot-password').send({ email: '' });
      expect(res.status).toBe(400);
    });

    it('issues a fresh token and invalidates the previous one', async () => {
      const firstToken = lastToken(mainCaptured);

      const before = rlCaptured.length;
      const res = await requestReset(rlApp, ownerEmail);
      expect(res.status).toBe(200);
      expect(rlCaptured.length).toBe(before + 1);
      const secondToken = lastToken(rlCaptured);
      expect(secondToken).not.toBe(firstToken);

      const reuse = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token: firstToken, password: newPassword });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe('invalid_reset_token');

      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS c FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL',
        [ownerUserId],
      );
      expect(Number(rows[0]?.c)).toBe(1);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('resets the password, revokes sessions and refuses token reuse', async () => {
      const before = rlCaptured.length;
      const forgot = await requestReset(rlApp, ownerEmail);
      expect(forgot.status).toBe(200);
      expect(rlCaptured.length).toBe(before + 1);
      const token = lastToken(rlCaptured);

      const oldSessionCheck = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ownerCookie);
      expect(oldSessionCheck.status).toBe(200);

      const res = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token, password: newPassword });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const oldLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: ownerPassword });
      expect(oldLogin.status).toBe(401);

      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: ownerEmail, password: newPassword });
      expect(newLogin.status).toBe(200);

      const sessionAfter = await request(app).get('/api/auth/me').set('Cookie', ownerCookie);
      expect(sessionAfter.status).toBe(401);

      const reuse = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token, password: ownerPassword });
      expect(reuse.status).toBe(400);
      expect(reuse.body.error.code).toBe('invalid_reset_token');

      const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
        "SELECT action FROM audit_logs WHERE user_id = ? AND action = 'password_reset_completed'",
        [ownerUserId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects an expired token', async () => {
      const before = rlCaptured.length;
      await requestReset(rlApp, ownerEmail);
      expect(rlCaptured.length).toBe(before + 1);
      const token = lastToken(rlCaptured);
      await pool.query(
        'UPDATE password_reset_tokens SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE token_hash = ?',
        [hashResetToken(token)],
      );

      const res = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token, password: newPassword });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_reset_token');
    });

    it('rejects a malformed token and a weak password', async () => {
      const badToken = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token: 'not-a-real-token', password: newPassword });
      expect(badToken.status).toBe(400);
      expect(badToken.body.error.code).toBe('invalid_reset_token');

      const before = rlCaptured.length;
      await requestReset(rlApp, ownerEmail);
      expect(rlCaptured.length).toBe(before + 1);
      const token = lastToken(rlCaptured);

      const weak = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token, password: 'short' });
      expect(weak.status).toBe(400);

      const missingPassword = await request(rlApp)
        .post('/api/auth/reset-password')
        .send({ token });
      expect(missingPassword.status).toBe(400);

      const [stillUnused] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT used_at FROM password_reset_tokens WHERE token_hash = ?',
        [hashResetToken(token)],
      );
      expect(stillUnused[0]?.used_at).toBeNull();
    });

    it('does not issue tokens for disabled accounts but still answers generically', async () => {
      await pool.query("UPDATE users SET status = 'disabled' WHERE id = ?", [ownerUserId]);
      const before = rlCaptured.length;
      const res = await requestReset(rlApp, ownerEmail);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(genericMessage);
      expect(rlCaptured.length).toBe(before);
      await pool.query("UPDATE users SET status = 'active' WHERE id = ?", [ownerUserId]);
    });
  });

  describe('rate limits', () => {
    it('rate-limits forgot-password per email', async () => {
      const email = 'flood.reset@apextest.local';
      for (let i = 0; i < 5; i += 1) {
        const res = await requestReset(rateApp, email);
        expect(res.status).toBe(200);
      }
      const blocked = await requestReset(rateApp, email);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('rate_limited');
    });

    it('rate-limits reset-password submissions per client', async () => {
      for (let i = 0; i < 10; i += 1) {
        const res = await request(rateApp)
          .post('/api/auth/reset-password')
          .send({ token: `flood-token-${i}`, password: 'FloodAttemptPassw0rd!26x' });
        expect(res.status).toBe(400);
      }
      const blocked = await request(rateApp)
        .post('/api/auth/reset-password')
        .send({ token: 'flood-token-11', password: 'FloodAttemptPassw0rd!26x' });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('rate_limited');
    });
  });
});
