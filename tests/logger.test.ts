import { describe, expect, it } from 'vitest';
import { createLogger, redactUrl } from '../src/logger';

function capture(level?: 'debug' | 'info' | 'warn' | 'error') {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (line) => lines.push(line),
  });
  return { logger, lines };
}

describe('createLogger', () => {
  it('emits structured JSON lines with ts, level and msg', () => {
    const { logger, lines } = capture();
    logger.info('hello', { requestId: 'r1' });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.msg).toBe('hello');
    expect(entry.level).toBe('info');
    expect(entry.requestId).toBe('r1');
    expect(typeof entry.ts).toBe('string');
    expect(Number.isNaN(Date.parse(entry.ts as string))).toBe(false);
  });

  it('filters messages below the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines).toHaveLength(2);
    const levels = lines.map(
      (l) => (JSON.parse(l) as { level: string }).level,
    );
    expect(levels).toEqual(['warn', 'error']);
  });

  it('redacts secret-looking keys at any depth', () => {
    const { logger, lines } = capture();
    logger.info('creds', {
      password: 'p1',
      nested: { apiKey: 'k', token: 't', keep: 'visible' },
      list: [{ authorization: 'Bearer x', db: { DB_PASSWORD: 'q' } }],
    });
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.password).toBe('[REDACTED]');
    const nested = entry.nested as Record<string, unknown>;
    expect(nested.apiKey).toBe('[REDACTED]');
    expect(nested.token).toBe('[REDACTED]');
    expect(nested.keep).toBe('visible');
    const item = (entry.list as Array<Record<string, unknown>>)[0];
    expect(item?.authorization).toBe('[REDACTED]');
    expect((item?.db as Record<string, unknown>).DB_PASSWORD).toBe(
      '[REDACTED]',
    );
  });

  it('redacts child bindings', () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      bindings: { secret: 'hide-me' },
    });
    logger.child({ component: 'api' }).info('boot');
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.secret).toBe('[REDACTED]');
    expect(entry.component).toBe('api');
  });

  it('does not throw on circular field references', () => {
    const { logger, lines } = capture();
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    logger.info('circular', { payload: circular });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.msg).toBe('circular');
  });
});

describe('redactUrl', () => {
  it('returns urls without a query string unchanged', () => {
    expect(redactUrl('/api/organizations/7/patients')).toBe(
      '/api/organizations/7/patients',
    );
  });

  it('returns a trailing bare question mark unchanged', () => {
    expect(redactUrl('/api/leads?')).toBe('/api/leads?');
  });

  it('redacts secret-looking query values and keeps the rest', () => {
    const redacted = redactUrl(
      '/api/webhooks/whatsapp/7?hub.mode=subscribe&hub.challenge=123&hub.verify_token=sekrit',
    );
    expect(redacted).toContain('hub.verify_token=[REDACTED]');
    expect(redacted).toContain('hub.mode=subscribe');
    expect(redacted).toContain('hub.challenge=123');
    expect(redacted).not.toContain('sekrit');
  });

  it('redacts password, api key, secret and credential params', () => {
    const redacted = redactUrl(
      '/x?DB_PASSWORD=hide&api_key=hide&signingSecret=hide&credential=hide&keep=1',
    );
    expect(redacted).toBe(
      '/x?DB_PASSWORD=[REDACTED]&api_key=[REDACTED]&signingSecret=[REDACTED]&credential=[REDACTED]&keep=1',
    );
  });

  it('redacts percent-encoded secret-looking keys', () => {
    const redacted = redactUrl('/x?hub.verify%5Ftoken=sekrit&ok=1');
    expect(redacted).toBe('/x?hub.verify%5Ftoken=[REDACTED]&ok=1');
  });

  it('keeps params without a value and survives malformed encoding', () => {
    expect(redactUrl('/x?flag&token=hide')).toBe('/x?flag&token=[REDACTED]');
    expect(redactUrl('/x?bad%zz=1&token=hide')).toBe(
      '/x?bad%zz=1&token=[REDACTED]',
    );
  });
});
