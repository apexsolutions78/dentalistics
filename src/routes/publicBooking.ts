import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { AppError } from '../errors';
import { readJsonBody } from '../http/body';
import type { Logger } from '../logger';
import type { BookingMailer } from '../mail/bookingMailer';
import type { RateLimiter } from '../security/rateLimit';
import { createOnlineBooking, getPublicBooking, getPublicSlots } from '../services/onlineBooking';

export interface PublicBookingRouterDeps {
  db: Pool;
  logger: Logger;
  readLimiter: RateLimiter;
  writeIpLimiter: RateLimiter;
  writeKeyLimiter: RateLimiter;
  mailer: BookingMailer;
}

function siteKeyFrom(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  return raw.trim().toLowerCase();
}

export function createPublicBookingRouter(deps: PublicBookingRouterDeps): Router {
  const router = Router();

  router.get('/booking/:siteKey', async (req: Request, res: Response) => {
    if (!deps.readLimiter.check(`booking-read|ip|${req.ip ?? 'unknown'}`)) {
      throw new AppError('Too many requests, try again later', 429, 'rate_limited', true);
    }
    const view = await getPublicBooking(deps.db, siteKeyFrom(req.params.siteKey));
    if (view === null) {
      throw new AppError('Booking page not found', 404, 'not_found', true);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(view);
  });

  router.get('/booking/:siteKey/slots', async (req: Request, res: Response) => {
    if (!deps.readLimiter.check(`booking-read|ip|${req.ip ?? 'unknown'}`)) {
      throw new AppError('Too many requests, try again later', 429, 'rate_limited', true);
    }
    const doctorId = req.query.doctorId;
    const slots = await getPublicSlots(
      deps.db,
      siteKeyFrom(req.params.siteKey),
      req.query.date,
      Array.isArray(doctorId) ? doctorId[0] : doctorId,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(slots);
  });

  router.post('/booking/:siteKey', async (req: Request, res: Response) => {
    const siteKey = siteKeyFrom(req.params.siteKey);
    const ip = req.ip ?? 'unknown';
    if (!deps.writeIpLimiter.check(`booking-write|ip|${ip}`)) {
      deps.logger.warn('online booking rate limited', { scope: 'ip' });
      throw new AppError('Too many booking attempts, try again later', 429, 'rate_limited', true);
    }
    if (siteKey !== '' && !deps.writeKeyLimiter.check(`booking-write|key|${siteKey}`)) {
      deps.logger.warn('online booking rate limited', { scope: 'key' });
      throw new AppError('Too many booking attempts, try again later', 429, 'rate_limited', true);
    }
    const result = await createOnlineBooking(deps.db, deps.logger, deps.mailer, {
      siteKey,
      body: readJsonBody(req),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(result);
  });

  return router;
}
