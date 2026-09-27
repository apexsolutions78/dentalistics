import 'dotenv/config';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbConfig } from '../src/config';
import { MockProvider, MOCK_FAIL_RECIPIENT } from '../src/communications/mockProvider';
import type { CommunicationProvider } from '../src/communications/types';
import { runMigrations } from '../src/db/migrate';
import { createPool } from '../src/db/pool';
import type { Logger } from '../src/logger';
import {
  applyProviderStatus,
  createMessage,
  getMessage,
  listMessages,
  sendMessage,
} from '../src/services/messages';

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
  'M4 acceptance: communication abstraction',
  () => {
    let pool: mysql.Pool;
    let orgId: number;
    let otherOrgId: number;

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

      await pool.query('DELETE FROM communication_messages');
      const [orgARow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['M4 Clinic A'],
      );
      orgId = orgARow.insertId;
      const [orgBRow] = await pool.query<mysql.ResultSetHeader>(
        'INSERT INTO organizations (name) VALUES (?)',
        ['M4 Clinic B'],
      );
      otherOrgId = orgBRow.insertId;
    }, 30_000);

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.query('DELETE FROM communication_messages');
        await pool.end();
      }
    });

    it('creates a PENDING message with normalized recipient and reads it back', async () => {
      const logger = captureLogger();
      const { message, created } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '+973 5555 1234',
        body: '  Hello there  ',
        idempotencyKey: 'm4-create-1',
      });
      expect(created).toBe(true);
      expect(message).toMatchObject({
        organizationId: orgId,
        channel: 'SMS',
        recipient: '97355551234',
        body: 'Hello there',
        status: 'PENDING',
        providerKey: null,
        providerMessageId: null,
        providerError: null,
        idempotencyKey: 'm4-create-1',
        attempts: 0,
        sentAt: null,
        deliveredAt: null,
      });
      const id = message.id as number;

      const fetched = await getMessage(pool, orgId, id);
      expect(fetched).toMatchObject({ id, status: 'PENDING' });

      const pendingList = await listMessages(pool, {
        organizationId: orgId,
        query: { status: 'PENDING' },
      });
      expect(pendingList.total).toBeGreaterThanOrEqual(1);
      expect(pendingList.messages.map((m) => m.id)).toContain(id);

      const channelList = await listMessages(pool, {
        organizationId: orgId,
        query: { channel: 'SMS' },
      });
      expect(channelList.messages.map((m) => m.id)).toContain(id);
    }, 15_000);

    it('validates message input and organization', async () => {
      const logger = captureLogger();
      const base = {
        organizationId: orgId,
        channel: 'SMS',
        to: '97311112222',
        body: 'x',
        idempotencyKey: 'm4-valid-1',
      };

      await expect(
        createMessage(pool, logger, { ...base, channel: 'EMAIL' }),
      ).rejects.toMatchObject({ statusCode: 400, code: 'validation_failed' });
      await expect(
        createMessage(pool, logger, { ...base, to: '12' }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createMessage(pool, logger, { ...base, body: '' }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createMessage(pool, logger, { ...base, body: 'x'.repeat(4097) }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createMessage(pool, logger, { ...base, idempotencyKey: undefined }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createMessage(pool, logger, { ...base, idempotencyKey: 'k'.repeat(129) }),
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        createMessage(pool, logger, { ...base, organizationId: 999999 }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
      await expect(
        listMessages(pool, { organizationId: 999999, query: {} }),
      ).rejects.toMatchObject({ statusCode: 404 });
      await expect(
        listMessages(pool, { organizationId: orgId, query: { status: 'BANANA' } }),
      ).rejects.toMatchObject({ statusCode: 400 });
    }, 15_000);

    it('sends through the provider: PENDING to SENT, then skips repeat sends', async () => {
      const logger = captureLogger();
      const provider = new MockProvider();
      const { message } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550001',
        body: 'Your appointment is confirmed',
        idempotencyKey: 'm4-send-1',
      });
      const id = message.id as number;

      const first = await sendMessage(pool, logger, provider, orgId, id);
      expect(first.outcome).toBe('sent');
      expect(first.message).toMatchObject({
        status: 'SENT',
        providerKey: 'mock',
        providerError: null,
        attempts: 1,
      });
      expect(first.message.providerMessageId).toMatch(/^mock-/);
      expect(first.message.sentAt).not.toBeNull();
      expect(provider.attempts).toHaveLength(1);
      expect(provider.attempts[0]).toMatchObject({
        messageId: id,
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550001',
        body: 'Your appointment is confirmed',
      });

      const second = await sendMessage(pool, logger, provider, orgId, id);
      expect(second.outcome).toBe('skipped');
      expect(second.message.attempts).toBe(1);
      expect(second.message.status).toBe('SENT');
      expect(provider.attempts).toHaveLength(1);
    }, 15_000);

    it('handles provider failure, stores the error, and allows retry', async () => {
      const logger = captureLogger();
      const provider = new MockProvider();
      const { message } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: MOCK_FAIL_RECIPIENT,
        body: 'This will fail',
        idempotencyKey: 'm4-fail-1',
      });
      const id = message.id as number;

      const first = await sendMessage(pool, logger, provider, orgId, id);
      expect(first.outcome).toBe('failed');
      expect(first.message).toMatchObject({
        status: 'FAILED',
        providerKey: 'mock',
        attempts: 1,
        sentAt: null,
      });
      expect(first.message.providerError).toBe(
        `mock_recipient_failure: mock provider rejected recipient ${MOCK_FAIL_RECIPIENT}`,
      );

      const failureLog = logger.entries.find(
        (entry) => entry.level === 'error' && entry.message === 'message failed',
      );
      expect(failureLog).toBeDefined();
      expect(failureLog?.fields).toMatchObject({
        messageId: id,
        code: 'mock_recipient_failure',
        attempts: 1,
      });

      const retry = await sendMessage(pool, logger, provider, orgId, id);
      expect(retry.outcome).toBe('failed');
      expect(retry.message.attempts).toBe(2);
      expect(retry.message.status).toBe('FAILED');
      expect(provider.attempts).toHaveLength(2);
    }, 15_000);

    it('captures generic provider errors with the provider_error code', async () => {
      const logger = captureLogger();
      const broken: CommunicationProvider = {
        key: 'broken',
        send: async () => {
          throw new Error('connection refused');
        },
      };
      const { message } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97311112345',
        body: 'Generic failure path',
        idempotencyKey: 'm4-generic-1',
      });
      const id = message.id as number;

      const result = await sendMessage(pool, logger, broken, orgId, id);
      expect(result.outcome).toBe('failed');
      expect(result.message).toMatchObject({
        status: 'FAILED',
        providerKey: 'broken',
        attempts: 1,
      });
      expect(result.message.providerError).toBe('provider_error: connection refused');
    }, 15_000);

    it('applies delivery statuses only from SENT', async () => {
      const logger = captureLogger();
      const provider = new MockProvider();

      const { message: sentMsg } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550002',
        body: 'Delivery path',
        idempotencyKey: 'm4-delivery-1',
      });
      const sentId = sentMsg.id as number;
      await sendMessage(pool, logger, provider, orgId, sentId);

      const delivered = await applyProviderStatus(pool, logger, {
        organizationId: orgId,
        messageId: sentId,
        status: 'DELIVERED',
      });
      expect(delivered).toMatchObject({ status: 'DELIVERED' });
      expect(delivered.deliveredAt).not.toBeNull();

      const { message: pendingMsg } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550003',
        body: 'Not sent yet',
        idempotencyKey: 'm4-delivery-2',
      });
      await expect(
        applyProviderStatus(pool, logger, {
          organizationId: orgId,
          messageId: pendingMsg.id as number,
          status: 'DELIVERED',
        }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'invalid_status_transition' });

      await expect(
        applyProviderStatus(pool, logger, {
          organizationId: orgId,
          messageId: 999999,
          status: 'DELIVERED',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      await expect(
        applyProviderStatus(pool, logger, {
          organizationId: orgId,
          messageId: sentId,
          status: 'BANANA',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      const { message: secondMsg } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: '97355550004',
        body: 'Undelivered path',
        idempotencyKey: 'm4-delivery-3',
      });
      const secondId = secondMsg.id as number;
      await sendMessage(pool, logger, provider, orgId, secondId);
      const undelivered = await applyProviderStatus(pool, logger, {
        organizationId: orgId,
        messageId: secondId,
        status: 'UNDELIVERED',
      });
      expect(undelivered).toMatchObject({ status: 'UNDELIVERED', deliveredAt: null });
    }, 15_000);

    it('is idempotent on create: the same key returns the existing message', async () => {
      const logger = captureLogger();
      const first = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550005',
        body: 'Idempotency check',
        idempotencyKey: 'm4-idem-1',
      });
      expect(first.created).toBe(true);
      const firstId = first.message.id as number;

      const before = await listMessages(pool, { organizationId: orgId, query: {} });
      const second = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'WHATSAPP',
        to: '97355550006',
        body: 'Different body, same key',
        idempotencyKey: 'm4-idem-1',
      });
      expect(second.created).toBe(false);
      expect(second.message.id).toBe(firstId);
      expect(second.message.body).toBe('Idempotency check');

      const after = await listMessages(pool, { organizationId: orgId, query: {} });
      expect(after.total).toBe(before.total);

      const third = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550005',
        body: 'Idempotency check',
        idempotencyKey: 'm4-idem-2',
      });
      expect(third.created).toBe(true);
      expect(third.message.id).not.toBe(firstId);
    }, 15_000);

    it('logs the message lifecycle at the right levels', async () => {
      const logger = captureLogger();
      const provider = new MockProvider();
      const { message } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550007',
        body: 'Lifecycle logging',
        idempotencyKey: 'm4-log-1',
      });
      const id = message.id as number;

      const createdLog = logger.entries.find(
        (entry) => entry.level === 'info' && entry.message === 'message created',
      );
      expect(createdLog?.fields).toMatchObject({ messageId: id, channel: 'SMS' });

      await sendMessage(pool, logger, provider, orgId, id);
      const sentLog = logger.entries.find(
        (entry) => entry.level === 'info' && entry.message === 'message sent',
      );
      expect(sentLog?.fields).toMatchObject({ messageId: id, provider: 'mock', attempts: 1 });

      await applyProviderStatus(pool, logger, {
        organizationId: orgId,
        messageId: id,
        status: 'DELIVERED',
      });
      const deliveryLog = logger.entries.find(
        (entry) => entry.level === 'info' && entry.message === 'delivery status updated',
      );
      expect(deliveryLog?.fields).toMatchObject({ messageId: id, status: 'DELIVERED' });

      const sentList = await listMessages(pool, {
        organizationId: orgId,
        query: { status: 'SENT', channel: 'WHATSAPP' },
      });
      expect(sentList.total).toBeGreaterThanOrEqual(0);
    }, 15_000);

    it('scopes messages to their organization', async () => {
      const logger = captureLogger();
      const provider = new MockProvider();
      const { message } = await createMessage(pool, logger, {
        organizationId: orgId,
        channel: 'SMS',
        to: '97355550008',
        body: 'Tenant scoping',
        idempotencyKey: 'm4-tenant-1',
      });
      const id = message.id as number;

      const foreignGet = await getMessage(pool, otherOrgId, id);
      expect(foreignGet).toBeNull();

      const foreignList = await listMessages(pool, { organizationId: otherOrgId, query: {} });
      expect(foreignList.messages.map((m) => m.id)).not.toContain(id);

      await expect(
        sendMessage(pool, logger, provider, otherOrgId, id),
      ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });

      await expect(
        applyProviderStatus(pool, logger, {
          organizationId: otherOrgId,
          messageId: id,
          status: 'DELIVERED',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      const ownCreate = await createMessage(pool, logger, {
        organizationId: otherOrgId,
        channel: 'SMS',
        to: '97355550009',
        body: 'Other clinic message',
        idempotencyKey: 'm4-tenant-2',
      });
      expect(ownCreate.created).toBe(true);
      expect(ownCreate.message.organizationId).toBe(otherOrgId);
    }, 15_000);
  },
);
