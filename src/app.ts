import express from 'express';
import type { Express, Request, Response } from 'express';
import { errorHandler, notFoundHandler } from './errors';
import { createLogger } from './logger';
import type { Logger } from './logger';

export type DatabaseStatus = 'up' | 'down' | 'unconfigured';

export interface AppDeps {
  logger?: Logger;
  checkDatabase?: () => Promise<DatabaseStatus>;
}

function silentLogger(): Logger {
  return createLogger({ level: 'error', write: () => undefined });
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  const logger = deps.logger ?? silentLogger();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req: Request, res: Response, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  });

  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ service: 'dentalistics', status: 'running' });
  });

  app.get('/health', async (_req: Request, res: Response) => {
    let database: DatabaseStatus = 'unconfigured';
    if (deps.checkDatabase !== undefined) {
      try {
        database = await deps.checkDatabase();
      } catch {
        database = 'down';
      }
    }
    const healthy = database !== 'down';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
