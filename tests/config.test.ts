import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const validEnv: NodeJS.ProcessEnv = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_PASSWORD: 'pw',
  DB_NAME: 'app',
};

describe('loadConfig', () => {
  it('loads a valid environment with defaults', () => {
    const cfg = loadConfig(validEnv);
    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.migrationsDir).toBe('./migrations');
    expect(cfg.db).toEqual({
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: 'pw',
      database: 'app',
    });
  });

  it('honours explicit overrides', () => {
    const cfg = loadConfig({
      ...validEnv,
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DB_PORT: '3307',
      DB_NAME: 'other',
      MIGRATIONS_DIR: '/abs/migrations',
    });
    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe('debug');
    expect(cfg.db.port).toBe(3307);
    expect(cfg.db.database).toBe('other');
    expect(cfg.migrationsDir).toBe('/abs/migrations');
  });

  it('rejects a missing DB_HOST', () => {
    const env = { ...validEnv };
    delete env.DB_HOST;
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const configError = caught as ConfigError;
    expect(configError.issues.some((i) => i.includes('DB_HOST'))).toBe(true);
    expect(configError.message).toContain('DB_HOST');
  });

  it('rejects invalid PORT, LOG_LEVEL and NODE_ENV together', () => {
    const env = {
      ...validEnv,
      PORT: 'not-a-number',
      LOG_LEVEL: 'loud',
      NODE_ENV: 'staging',
    };
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const configError = caught as ConfigError;
    expect(configError.issues).toHaveLength(3);
    expect(configError.message).toContain('PORT');
    expect(configError.message).toContain('LOG_LEVEL');
    expect(configError.message).toContain('NODE_ENV');
  });

  it('rejects an out-of-range port', () => {
    const env = { ...validEnv, PORT: '70000' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('rejects a missing DB_PASSWORD but allows an empty one', () => {
    const missing = { ...validEnv };
    delete missing.DB_PASSWORD;
    let caught: unknown;
    try {
      loadConfig(missing);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).toContain('DB_PASSWORD');
    expect(loadConfig({ ...validEnv, DB_PASSWORD: '' }).db.password).toBe('');
  });

  it('never includes the password value in error messages', () => {
    const env = { ...validEnv, DB_PASSWORD: 'supersecretvalue', PORT: 'abc' };
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).message).not.toContain(
      'supersecretvalue',
    );
  });

  it('defaults TRUST_PROXY to false when unset or empty', () => {
    expect(loadConfig(validEnv).trustProxy).toBe(false);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '' }).trustProxy).toBe(
      false,
    );
  });

  it('parses TRUST_PROXY true/false and hop counts', () => {
    expect(loadConfig({ ...validEnv, TRUST_PROXY: 'true' }).trustProxy).toBe(
      true,
    );
    expect(
      loadConfig({ ...validEnv, TRUST_PROXY: 'false' }).trustProxy,
    ).toBe(false);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '10' }).trustProxy).toBe(
      10,
    );
  });

  it('rejects invalid TRUST_PROXY values', () => {
    for (const raw of ['no', '1.5', '-1', '11']) {
      let caught: unknown;
      try {
        loadConfig({ ...validEnv, TRUST_PROXY: raw });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).message).toContain('TRUST_PROXY');
    }
  });
});
