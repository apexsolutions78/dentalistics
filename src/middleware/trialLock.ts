import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { organizationAccess } from '../billing/entitlement';
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
    organizationAccess(db, user.organizationId)
      .then((access) => {
        if (access !== null && access.readOnly) {
          const trial = access.phase === 'trial_expired';
          next(
            new AppError(
              trial
                ? 'Your free trial has ended. This clinic is now read-only until it is activated.'
                : 'The subscription for this clinic has ended. It is read-only until it is renewed. Existing records are unchanged.',
              403,
              trial ? 'trial_expired' : 'subscription_expired',
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
