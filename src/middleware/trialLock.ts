import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { AppError } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EXEMPT_PREFIXES = ['/api/auth', '/api/public', '/api/webhooks'];

const BILLING_PATH = /^\/api\/organizations\/\d+\/billing(\/|$)/;

export function createTrialLock(db: Pool): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const user = req.user;
    if (user === undefined || user.organizationId === null || user.role === 'admin') {
      next();
      return;
    }
    if (EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }
    if (BILLING_PATH.test(req.path)) {
      next();
      return;
    }
    db.query<RowDataPacket[]>(
      `SELECT id FROM organizations
       WHERE id = ? AND plan = 'trial'
         AND trial_ends_at IS NOT NULL AND trial_ends_at <= UTC_TIMESTAMP()`,
      [user.organizationId],
    )
      .then(([rows]) => {
        if (rows.length > 0) {
          next(
            new AppError(
              'Your free trial has ended. This clinic is now read-only until it is activated.',
              403,
              'trial_expired',
              true,
            ),
          );
          return;
        }
        next();
      })
      .catch(next);
  };
}
