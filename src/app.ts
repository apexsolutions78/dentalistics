import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';
import { loadWhatsAppConfig } from './communications/whatsappConfig';
import { WhatsAppProvider } from './communications/whatsappProvider';
import { registerProvider } from './communications/registry';
import { errorHandler, notFoundHandler } from './errors';
import { createLogger, redactUrl } from './logger';
import type { Logger } from './logger';
import { attachSession } from './middleware/auth';
import { createAdminRouter } from './routes/admin';
import { createAppointmentsRouter } from './routes/appointments';
import { createAuthRouter } from './routes/auth';
import { createCallEventsRouter } from './routes/callEvents';
import { createCommunicationsRouter } from './routes/communications';
import { createConversationStateRouter } from './routes/conversationState';
import { createDashboardRouter } from './routes/dashboard';
import { createLeadsRouter } from './routes/leads';
import { createOrganizationsRouter } from './routes/organizations';
import { createObservabilityRouter } from './routes/observability';
import { createPatientsRouter } from './routes/patients';
import { createPublicRouter } from './routes/public';
import { createRecallsRouter } from './routes/recalls';
import { recordErrorEvent } from './services/observability';
import { createSettingsRouter } from './routes/settings';
import { createWebhookRouter } from './routes/webhooks';
import { createWhatsAppWebhookRouter } from './routes/whatsappWebhook';
import { createWorkspaceRouter } from './routes/workspace';
import { createPasswordResetMailerFromEnv } from './mail/passwordResetMailer';
import type { PasswordResetMailer } from './mail/passwordResetMailer';
import {
  createRateLimiter,
  LOGIN_RATE_LIMIT,
  LOGIN_RATE_WINDOW_MS,
  PASSWORD_RESET_RATE_WINDOW_MS,
  PASSWORD_RESET_REQUEST_LIMIT,
  PASSWORD_RESET_SUBMIT_LIMIT,
  PUBLIC_LEAD_IP_LIMIT,
  PUBLIC_LEAD_KEY_LIMIT,
  PUBLIC_LEAD_RATE_WINDOW_MS,
  TELEPHONY_WEBHOOK_IP_LIMIT,
  TELEPHONY_WEBHOOK_RATE_WINDOW_MS,
  WHATSAPP_WEBHOOK_IP_LIMIT,
  WHATSAPP_WEBHOOK_RATE_WINDOW_MS,
} from './security/rateLimit';

export type DatabaseStatus = 'up' | 'down' | 'unconfigured';

export interface AppDeps {
  logger?: Logger;
  checkDatabase?: () => Promise<DatabaseStatus>;
  db?: Pool;
  secureCookies?: boolean;
  trustProxy?: boolean | number;
  publicLeadRate?: { perIp: number; perKey: number; windowMs?: number };
  uiDistDir?: string | null;
  passwordResetMailer?: PasswordResetMailer;
  resetBaseUrl?: string;
}

function silentLogger(): Logger {
  return createLogger({ level: 'error', write: () => undefined });
}

export function createApp(deps: AppDeps = {}): Express {
  const app = express();
  const logger = deps.logger ?? silentLogger();
  const secureCookies = deps.secureCookies ?? false;

  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy ?? false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use((req: Request, res: Response, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        method: req.method,
        path: redactUrl(req.originalUrl),
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  });

  const uiDistDir =
    deps.uiDistDir === null
      ? null
      : (deps.uiDistDir ?? process.env.UI_DIST_DIR ?? path.join(__dirname, '..', 'frontend', 'dist'));
  const uiIndexPath = uiDistDir === null ? null : path.join(uiDistDir, 'index.html');
  const uiAvailable = uiIndexPath !== null && fs.existsSync(uiIndexPath);

  if (uiAvailable && uiIndexPath !== null) {
    logger.info('serving frontend ui', { uiDistDir });
    app.get('/', (_req: Request, res: Response) => {
      res.sendFile(uiIndexPath);
    });
  } else {
    if (uiIndexPath !== null) {
      logger.warn('frontend build not found; UI not served', { uiDistDir });
    }
    app.get('/', (_req: Request, res: Response) => {
      res.status(200).json({ service: 'dentalistics', status: 'running' });
    });
  }

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
        resetRequestLimiter: createRateLimiter(
          PASSWORD_RESET_REQUEST_LIMIT,
          PASSWORD_RESET_RATE_WINDOW_MS,
        ),
        resetSubmitLimiter: createRateLimiter(
          PASSWORD_RESET_SUBMIT_LIMIT,
          PASSWORD_RESET_RATE_WINDOW_MS,
        ),
        resetMailer: deps.passwordResetMailer ?? createPasswordResetMailerFromEnv(logger),
        resetBaseUrl: deps.resetBaseUrl ?? process.env.RESET_BASE_URL ?? '',
      }),
    );
    app.use('/api/admin', createAdminRouter({ db, logger }));
    app.use('/api/organizations', createOrganizationsRouter({ db, logger }));
    app.use('/api/organizations', createLeadsRouter({ db, logger }));
    app.use('/api/organizations', createPatientsRouter({ db, logger }));
    app.use('/api/organizations', createAppointmentsRouter({ db, logger }));
    app.use('/api/organizations', createDashboardRouter({ db, logger }));
    app.use('/api/organizations', createWorkspaceRouter({ db, logger }));
    app.use('/api/organizations', createSettingsRouter({ db, logger }));
    app.use('/api/organizations', createObservabilityRouter({ db, logger }));
    app.use('/api/organizations', createRecallsRouter({ db, logger }));
    app.use('/api/organizations', createCommunicationsRouter({ db, logger }));

    const publicRate = deps.publicLeadRate;
    app.use(
      '/api/public',
      createPublicRouter({
        db,
        logger,
        ipLimiter: createRateLimiter(
          publicRate?.perIp ?? PUBLIC_LEAD_IP_LIMIT,
          publicRate?.windowMs ?? PUBLIC_LEAD_RATE_WINDOW_MS,
        ),
        keyLimiter: createRateLimiter(
          publicRate?.perKey ?? PUBLIC_LEAD_KEY_LIMIT,
          publicRate?.windowMs ?? PUBLIC_LEAD_RATE_WINDOW_MS,
        ),
      }),
    );

    app.use('/api/organizations', createCallEventsRouter({ db, logger }));
    app.use(
      '/api/webhooks',
      createWebhookRouter({
        db,
        logger,
        ipLimiter: createRateLimiter(TELEPHONY_WEBHOOK_IP_LIMIT, TELEPHONY_WEBHOOK_RATE_WINDOW_MS),
      }),
    );

    registerProvider(
      new WhatsAppProvider(async (organizationId: number) => {
        const config = await loadWhatsAppConfig(db, organizationId);
        if (config.graph.accessToken === '' || config.graph.phoneNumberId === '') {
          return null;
        }
        return config.graph;
      }),
    );

    app.use('/api/organizations', createConversationStateRouter({ db, logger }));
    app.use(
      '/api/webhooks',
      createWhatsAppWebhookRouter({
        db,
        logger,
        ipLimiter: createRateLimiter(WHATSAPP_WEBHOOK_IP_LIMIT, WHATSAPP_WEBHOOK_RATE_WINDOW_MS),
      }),
    );
  }

  if (uiAvailable && uiIndexPath !== null && uiDistDir !== null) {
    const staticFiles = express.static(uiDistDir, { index: false });
    app.use((req: Request, res: Response, next) => {
      const isApi = req.path === '/api' || req.path.startsWith('/api/') || req.path === '/health';
      if (isApi || (req.method !== 'GET' && req.method !== 'HEAD')) {
        next();
        return;
      }
      staticFiles(req, res, (err?: unknown) => {
        if (err !== undefined && err !== null) {
          next(err);
          return;
        }
        res.sendFile(uiIndexPath);
      });
    });
  }

  app.use(notFoundHandler);
  if (deps.db !== undefined) {
    const errorDb = deps.db;
    app.use(
      errorHandler(logger, {
        recordError: (record) => recordErrorEvent(errorDb, logger, record),
      }),
    );
  } else {
    app.use(errorHandler(logger));
  }

  return app;
}
