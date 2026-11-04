import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { errorHandler } from '../src/errors';
import { createLogger } from '../src/logger';
import { createPublicRouter } from '../src/routes/public';
import { createRateLimiter } from '../src/security/rateLimit';
import {
  PUBLIC_ACTIVITY_SQL,
  activityLabel,
  createPublicActivityReader,
  genericService,
  loadRecentActivity,
} from '../src/services/publicActivity';

const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const FORBIDDEN_SQL = /\b(first_name|last_name|phone|email|body|recipient|notes|provider_message_id)\b/i;
const PII = [
  'Priya Shah',
  'priya.shah@example.com',
  '+97339990011',
  'Please call Priya about the abscess',
  'Smile Studio',
  'ZZ TEST',
];

function silentLogger() {
  return createLogger({ level: 'error', write: () => undefined });
}

interface SourceRow {
  service?: string | null;
  occurred_at: Date;
  first_name?: string;
  phone?: string;
  email?: string;
  body?: string;
  organization_id?: number;
  clinic_name?: string;
}

function sourceDb(state: {
  leads: SourceRow[];
  appointments: SourceRow[];
  replies: SourceRow[];
  queries: string[];
}): Pool {
  return {
    query: async (sql: string) => {
      state.queries.push(sql);
      if (sql.includes('FROM leads')) return [state.leads];
      if (sql.includes('FROM appointments')) return [state.appointments];
      if (sql.includes('FROM communication_messages')) return [state.replies];
      throw new Error(`unexpected sql: ${sql}`);
    },
  } as unknown as Pool;
}

function activityApp(
  db: Pool,
  options: {
    now: () => number;
    ttlMs?: number;
    perIp?: number;
  },
) {
  const app = express();
  app.use(
    '/api/public',
    createPublicRouter({
      db,
      logger: silentLogger(),
      ipLimiter: createRateLimiter(100, 60_000),
      keyLimiter: createRateLimiter(100, 60_000),
      activityLimiter: createRateLimiter(options.perIp ?? 30, 60_000),
      activityNow: options.now,
      activityTtlMs: options.ttlMs ?? 45_000,
    }),
  );
  app.use(errorHandler(silentLogger()));
  return app;
}

describe('public activity anonymizer', () => {
  it('keeps generic service words and drops anything else', () => {
    expect(genericService('Cleaning')).toBe('cleaning');
    expect(genericService('routine check-up')).toBe('checkup');
    expect(genericService('root canal')).toBe('root canal');
    expect(genericService('x-ray')).toBe('x-ray');
    expect(genericService('scale and polish')).toBe('cleaning');
    expect(genericService('cleaning and checkup')).toBe('cleaning and checkup');
    expect(genericService('cleaning for Priya Shah')).toBeNull();
    expect(genericService('+97339990011')).toBeNull();
    expect(genericService('Priya Shah')).toBeNull();
    expect(genericService('whitening at Smile Studio')).toBeNull();
    expect(genericService('')).toBeNull();
    expect(genericService(null)).toBeNull();
  });

  it('builds playful labels without a clock time', () => {
    expect(activityLabel('enquiry', 'cleaning')).toBe('New enquiry · cleaning');
    expect(activityLabel('enquiry', null)).toBe('New enquiry received');
    expect(activityLabel('reply', 'cleaning')).toBe('Reply sent');
    expect(activityLabel('booking', 'cleaning')).toBe('A clinic booked a cleaning');
    expect(activityLabel('booking', 'x-ray')).toBe('A clinic booked an x-ray');
    expect(activityLabel('booking', null)).toBe('A clinic booked a visit');
  });
});

describe('GET /api/public/activity', () => {
  it('returns at most three anonymized events and no PII fields', async () => {
    let now = NOW;
    const state: {
      queries: string[];
      leads: SourceRow[];
      appointments: SourceRow[];
      replies: SourceRow[];
    } = {
      queries: [],
      leads: [
        {
          service: 'Routine cleaning',
          occurred_at: new Date(NOW - 12 * 60_000),
          first_name: 'Priya Shah',
          phone: '+97339990011',
          email: 'priya.shah@example.com',
          body: 'Please call Priya about the abscess',
          organization_id: 77,
          clinic_name: 'Smile Studio',
        },
        {
          service: 'Priya Shah',
          occurred_at: new Date(NOW - 30 * 60_000),
          phone: '+97339990011',
        },
      ],
      appointments: [
        {
          service: 'whitening',
          occurred_at: new Date(NOW - (4 * 60_000 + 50_000)),
          clinic_name: 'Smile Studio',
        },
      ],
      replies: [
        {
          occurred_at: new Date(NOW - 20_000),
          body: 'Please call Priya about the abscess',
          phone: '+97339990011',
        },
      ],
    };
    const app = activityApp(sourceDb(state), { now: () => now, ttlMs: 45_000 });

    const res = await request(app).get('/api/public/activity');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(Object.keys(res.body)).toEqual(['events']);
    expect(res.body.events).toEqual([
      { kind: 'reply', label: 'Reply sent', minutesAgo: 0 },
      { kind: 'booking', label: 'A clinic booked a whitening', minutesAgo: 4 },
      { kind: 'enquiry', label: 'New enquiry · cleaning', minutesAgo: 12 },
    ]);
    for (const event of res.body.events as Array<Record<string, unknown>>) {
      expect(Object.keys(event).sort()).toEqual(['kind', 'label', 'minutesAgo']);
    }
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    for (const secret of PII) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain('77');

    expect(state.queries).toHaveLength(3);
    for (const sql of state.queries) {
      expect(sql).toContain("NOT LIKE 'ZZ TEST%'");
      expect(sql).toContain('LIMIT ?');
      expect(sql).not.toMatch(FORBIDDEN_SQL);
    }
    expect(state.queries.some((sql) => sql.includes('idx_leads_created'))).toBe(true);
    expect(state.queries.some((sql) => sql.includes('idx_appointments_created'))).toBe(true);
    expect(state.queries.some((sql) => sql.includes('idx_comm_messages_outbound_sent'))).toBe(true);

    now += 20_000;
    const aged = await request(app).get('/api/public/activity');
    expect(state.queries).toHaveLength(3);
    expect(aged.body.events[1]).toMatchObject({
      kind: 'booking',
      minutesAgo: 5,
    });

    state.leads.unshift({
      service: 'emergency',
      occurred_at: new Date(NOW - 1_000),
    });
    const cached = await request(app).get('/api/public/activity');
    expect(cached.body.events.map((event: { label: string }) => event.label)).not.toContain(
      'New enquiry · emergency',
    );
    expect(state.queries).toHaveLength(3);

    now += 45_000;
    const refreshed = await request(app).get('/api/public/activity');
    expect(state.queries).toHaveLength(6);
    expect(refreshed.body.events[0]).toMatchObject({
      kind: 'enquiry',
      label: 'New enquiry · emergency',
    });
    expect(JSON.stringify(refreshed.body)).not.toContain('Priya');
  });

  it('returns an empty event list when nothing recent exists', async () => {
    const state = {
      queries: [] as string[],
      leads: [],
      appointments: [],
      replies: [],
    };
    const app = activityApp(sourceDb(state), { now: () => NOW });
    const first = await request(app).get('/api/public/activity');
    const second = await request(app).get('/api/public/activity');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ events: [] });
    expect(second.body).toEqual({ events: [] });
    expect(state.queries).toHaveLength(3);
  });

  it('rate limits like the other public routes', async () => {
    const state = {
      queries: [] as string[],
      leads: [],
      appointments: [],
      replies: [],
    };
    const app = activityApp(sourceDb(state), { now: () => NOW, perIp: 1 });
    const allowed = await request(app).get('/api/public/activity');
    const blocked = await request(app).get('/api/public/activity');
    expect(allowed.status).toBe(200);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('rate_limited');
    expect(state.queries).toHaveLength(3);
  });

  it('is mounted on the app for anonymous callers', async () => {
    const db = {
      query: async () => [[], []],
    } as unknown as Pool;
    const app = createApp({ db, publicActivity: { now: () => NOW, ttlMs: 45_000 } });
    const res = await request(app).get('/api/public/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
  });

  it('does not cache a failed load', async () => {
    let fail = true;
    const reader = createPublicActivityReader({
      load: async () => {
        if (fail) throw new Error('db down');
        return [
          {
            kind: 'reply',
            service: null,
            occurredAt: new Date(NOW - 5_000),
          },
        ];
      },
      now: () => NOW,
      ttlMs: 45_000,
    });
    await expect(reader.read()).rejects.toThrow('db down');
    fail = false;
    await expect(reader.read()).resolves.toEqual({
      events: [{ kind: 'reply', label: 'Reply sent', minutesAgo: 0 }],
    });
  });
});

describe('public activity sql', () => {
  it('selects only service and time, with the new indexes and a limit', async () => {
    const seen: string[] = [];
    const db = {
      query: async (sql: string, params: unknown[]) => {
        seen.push(sql);
        expect(params).toHaveLength(3);
        expect(params[2]).toBe(5);
        expect(params[0]).toBeInstanceOf(Date);
        expect(params[1]).toBeInstanceOf(Date);
        return [[]];
      },
    } as unknown as Pool;
    await loadRecentActivity(db, new Date(NOW - 86_400_000), new Date(NOW));
    expect(seen).toEqual([
      PUBLIC_ACTIVITY_SQL.leads,
      PUBLIC_ACTIVITY_SQL.appointments,
      PUBLIC_ACTIVITY_SQL.replies,
    ]);
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), 'migrations/0022_public_activity_indexes.sql'),
      'utf8',
    );
    for (const name of [
      'idx_leads_created',
      'idx_appointments_created',
      'idx_comm_messages_outbound_sent',
    ]) {
      expect(migration).toContain(name);
      expect(seen.some((sql) => sql.includes(name))).toBe(true);
    }
  });
});
