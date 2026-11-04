import mysql from 'mysql2/promise';
import type { Pool, PoolOptions } from 'mysql2/promise';
import type { DbConfig } from '../config';

let singletonPool: Pool | null = null;

export function poolOptions(cfg: DbConfig): PoolOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    enableKeepAlive: true,
  };
}

const UTC_SESSION_SQL = "SET time_zone = '+00:00'";

interface CallbackConnection {
  query(sql: string, callback: (err: Error | null) => void): void;
  destroy(): void;
}

/**
 * DATETIME columns store a zone-less wall clock. mysql2 timezone 'Z' reads
 * and writes that wall clock as UTC. CURRENT_TIMESTAMP / NOW() use the
 * session time zone, which on a DirectAdmin host follows the OS zone
 * (Asia/Karachi, UTC+5). Forcing the session to UTC on every new connection
 * makes those defaults, UTC_TIMESTAMP(), and JavaScript Date parameters
 * agree on the same UTC wall clock regardless of the server zone.
 *
 * The listener runs before the pool hands the connection out, and the SET
 * is queued ahead of the caller's first statement.
 */
export function enforceUtcSession(pool: Pool): void {
  pool.on('connection', (connection) => {
    const raw = connection as unknown as CallbackConnection;
    raw.query(UTC_SESSION_SQL, (err) => {
      if (err) {
        raw.destroy();
      }
    });
  });
}

export function createPool(cfg: DbConfig): Pool {
  const pool = mysql.createPool(poolOptions(cfg));
  enforceUtcSession(pool);
  return pool;
}

export function initPool(cfg: DbConfig): Pool {
  if (singletonPool !== null) {
    throw new Error('Database pool already initialized');
  }
  singletonPool = createPool(cfg);
  return singletonPool;
}

export function getPool(): Pool {
  if (singletonPool === null) {
    throw new Error('Database pool not initialized');
  }
  return singletonPool;
}

export async function closePool(): Promise<void> {
  if (singletonPool !== null) {
    const pool = singletonPool;
    singletonPool = null;
    await pool.end();
  }
}

export async function checkDatabase(
  pool: Pool,
  timeoutMs = 2000,
): Promise<'up' | 'down'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('down'), timeoutMs);
    pool.query('SELECT 1').then(
      () => {
        clearTimeout(timer);
        resolve('up');
      },
      () => {
        clearTimeout(timer);
        resolve('down');
      },
    );
  });
}
