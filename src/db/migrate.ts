import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { ConfigError, loadEnv } from '../config';
import type { DbConfig } from '../config';
import { createLogger } from '../logger';
import type { Logger } from '../logger';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(255) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

function migrationPoolOptions(cfg: DbConfig): mysql.PoolOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 2,
    timezone: 'Z',
    multipleStatements: true,
  };
}

export async function runMigrations(
  cfg: DbConfig,
  dir: string,
  logger?: Logger,
): Promise<MigrationResult> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  const pool = mysql.createPool(migrationPoolOptions(cfg));
  try {
    await pool.query(CREATE_TRACKING_TABLE);
    const [rows] = await pool.query('SELECT name FROM schema_migrations');
    const appliedNames = new Set(
      (rows as Array<{ name: string }>).map((row) => row.name),
    );

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const fileName of migrationFiles) {
      if (appliedNames.has(fileName)) {
        skipped.push(fileName);
        continue;
      }
      const sql = await fs.readFile(path.join(dir, fileName), 'utf8');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(sql);
        await connection.query(
          'INSERT INTO schema_migrations (name) VALUES (?)',
          [fileName],
        );
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Migration ${fileName} failed: ${message}`, {
          cause: err,
        });
      } finally {
        connection.release();
      }
      applied.push(fileName);
      logger?.info('migration applied', { migration: fileName });
    }

    logger?.info('migration run complete', {
      applied: applied.length,
      skipped: skipped.length,
    });
    return { applied, skipped };
  } finally {
    await pool.end();
  }
}

async function runCli(): Promise<void> {
  const config = loadEnv();
  const logger = createLogger({ level: config.logLevel });
  const result = await runMigrations(config.db, config.migrationsDir, logger);
  logger.info('migrations finished', {
    applied: result.applied,
    skipped: result.skipped,
  });
}

if (require.main === module) {
  runCli().then(
    () => process.exit(0),
    (err: unknown) => {
      if (err instanceof ConfigError) {
        process.stderr.write(`${err.message}\n`);
      } else if (err instanceof Error) {
        process.stderr.write(`Migration run failed: ${err.message}\n`);
      } else {
        process.stderr.write(`Migration run failed: ${String(err)}\n`);
      }
      process.exit(1);
    },
  );
}
