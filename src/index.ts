import { runNoShowTick } from './automation/noShow';
import { runRecallTick } from './automation/recall';
import { runReminderTick } from './automation/reminders';
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

  const tickMs = Number(process.env.REMINDER_TICK_MS ?? '60000');
  let reminderTimer: NodeJS.Timeout | undefined;
  if (Number.isFinite(tickMs) && tickMs > 0) {
    reminderTimer = setInterval(() => {
      runReminderTick(getPool(), logger).catch((err: unknown) => {
        logger.error('reminder tick failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      runNoShowTick(getPool(), logger).catch((err: unknown) => {
        logger.error('no-show tick failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      runRecallTick(getPool(), logger).catch((err: unknown) => {
        logger.error('recall tick failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, tickMs);
    reminderTimer.unref();
    logger.info('reminder tick scheduled', { intervalMs: tickMs });
  } else {
    logger.info('reminder tick disabled', { reminderTickMs: process.env.REMINDER_TICK_MS ?? '' });
  }

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    if (reminderTimer !== undefined) {
      clearInterval(reminderTimer);
    }
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
