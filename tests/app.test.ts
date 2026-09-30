import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { errorHandler } from '../src/errors';
import { createLogger } from '../src/logger';

describe('createApp', () => {
  it('serves the root service descriptor', async () => {
    const app = createApp({ uiDistDir: null });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: 'dentalistics', status: 'running' });
  });

  it('reports 200 with database up', async () => {
    const app = createApp({ checkDatabase: async () => 'up' });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('reports 503 with database down', async () => {
    const app = createApp({ checkDatabase: async () => 'down' });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.database).toBe('down');
  });

  it('reports database unconfigured when no checker is provided', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('unconfigured');
  });

  it('treats a rejecting database check as down', async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error('boom');
      },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.database).toBe('down');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const app = createApp({ uiDistDir: null });
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('returns 413 for bodies over the 100kb limit', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
  });

  it('does not expose the x-powered-by header', async () => {
    const app = createApp({ uiDistDir: null });
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sets baseline security headers on responses', async () => {
    const app = createApp({ uiDistDir: null });
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('turns unhandled errors into a generic 500 without leaking details', async () => {
    const logger = createLogger({ level: 'error', write: () => undefined });
    const app = express();
    app.get('/boom', async () => {
      throw new Error('sensitive detail');
    });
    app.use(errorHandler(logger));
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal_error');
    expect(res.body.error.message).toBe('Internal server error');
    expect(JSON.stringify(res.body)).not.toContain('sensitive detail');
  });
});
