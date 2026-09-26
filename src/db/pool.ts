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

export function createPool(cfg: DbConfig): Pool {
  return mysql.createPool(poolOptions(cfg));
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
