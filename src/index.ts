import { createApp } from './app';
import { ConfigError, loadEnv } from './config';
import { checkDatabase, closePool, getPool, initPool } from './db/pool';
import { createLogger } from './logger';

function reportFatal(err: unknown): void {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`Fatal: ${err.message}\n`);
    if (err.stack !== undefined) {
      process.stderr.write(`${err.stack}\n`);
    }
  } else {
    process.stderr.write(`Fatal: ${String(err)}\n`);
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadEnv();
  } catch (err) {
    reportFatal(err);
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel });

  initPool(config.db);
  const dbStatus = await checkDatabase(getPool());
  if (dbStatus !== 'up') {
    logger.error('database unreachable at startup', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
    });
    await closePool();
    process.exit(1);
  }
  logger.info('database connection verified', {
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
  });

  const app = createApp({
    logger,
    checkDatabase: () => checkDatabase(getPool()),
    db: getPool(),
    secureCookies: config.nodeEnv === 'production',
  });

  const server = app.listen(config.port, () => {
    logger.info('server started', {
      port: config.port,
      nodeEnv: config.nodeEnv,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  reportFatal(err);
  process.exit(1);
});
