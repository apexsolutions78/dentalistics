import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'ui');
const missingDir = path.join(process.cwd(), 'tests', 'fixtures', 'no-such-ui');

describe('frontend ui serving (F1)', () => {
  it('serves index.html at the root when a build exists', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="root"');
  });

  it('serves static assets from the build directory', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).get('/assets/app.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.text).toContain('margin: 0');
  });

  it('falls back to index.html for unknown SPA routes', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).get('/settings/clinic');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('id="root"');
  });

  it('keeps unknown API routes as JSON 404s', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('keeps /health as JSON', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.database).toBe('unconfigured');
  });

  it('does not apply the SPA fallback to non-GET methods', async () => {
    const app = createApp({ uiDistDir: fixtureDir });
    const res = await request(app).post('/settings/clinic');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('serves the JSON root descriptor when UI serving is disabled', async () => {
    const app = createApp({ uiDistDir: null });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: 'dentalistics', status: 'running' });
  });

  it('serves the JSON root descriptor when the build directory is missing', async () => {
    const app = createApp({ uiDistDir: missingDir });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ service: 'dentalistics', status: 'running' });
  });
});
