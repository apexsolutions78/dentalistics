import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { getSessionUser } from '../auth/sessions';
import type { SessionUser } from '../auth/sessions';
import { parseCookieHeader, SESSION_COOKIE_NAME } from '../http/cookies';
import { AppError } from '../errors';

declare module 'express-serve-static-core' {
  interface Request {
    user?: SessionUser;
    sessionToken?: string;
  }
}

export function attachSession(db: Pool): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token === undefined) {
      next();
      return;
    }
    getSessionUser(db, token)
      .then((user) => {
        if (user !== null) {
          req.user = user;
          req.sessionToken = token;
        }
        next();
      })
      .catch(next);
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (req.user === undefined) {
    next(new AppError('Authentication required', 401, 'authentication_required', true));
    return;
  }
  next();
};

export function requireRole(...roles: Array<SessionUser['role']>): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new AppError('Authentication required', 401, 'authentication_required', true));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError('Forbidden', 403, 'forbidden', true));
      return;
    }
    next();
  };
}
