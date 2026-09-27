import express from 'express';
import type { Express, Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { errorHandler, notFoundHandler } from './errors';
import { createLogger } from './logger';
import type { Logger } from './logger';
import { attachSession } from './middleware/auth';
import { createAdminRouter } from './routes/admin';
import { createAuthRouter } from './routes/auth';
import { createOrganizationsRouter } from './routes/organizations';
import { createRateLimiter, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS } from './security/rateLimit';

export type DatabaseStatus = 'up' | 'down' | 'unconfigured';

export interface AppDeps {
  logger?: Logger;
  checkDatabase?: () => Promise<DatabaseStatus>;
  db?: Pool;
  secureCookies?: boolean;
}

function silentLogger(): Logger {
  return createLogger({ level: 'error', write: () => undefined });
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  const logger = deps.logger ?? silentLogger();
  const secureCookies = deps.secureCookies ?? false;

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

  if (deps.db !== undefined) {
    const db = deps.db;
    app.use(attachSession(db));
    app.use(
      '/api/auth',
      createAuthRouter({
        db,
        logger,
        secureCookies,
        loginLimiter: createRateLimiter(LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS),
      }),
    );
    app.use('/api/admin', createAdminRouter({ db, logger }));
    app.use('/api/organizations', createOrganizationsRouter({ db, logger }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
