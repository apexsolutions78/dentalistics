import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ValidationError } from '../errors';
import type { Logger } from '../logger';
import { requireString } from '../validate';

/** Used only when the plan_offer row is missing. Not a live trial length. */
export const SEED_TRIAL_DAYS = 8;

export interface PlanOffer {
  trialDays: number;
  trialLimitations: string;
  freeHeadline: string;
  freeBullets: string[];
  fullHeadline: string;
  fullBullets: string[];
}

interface OfferRow extends RowDataPacket {
  trial_days: number;
  trial_limitations: string;
  free_headline: string;
  free_bullets: string;
  full_headline: string;
  full_bullets: string;
}

const SEED_OFFER: PlanOffer = {
  trialDays: SEED_TRIAL_DAYS,
  trialLimitations:
    'Every feature is included until the trial ends. After that the clinic is read-only until a platform administrator activates it. No other limits apply during the trial.',
  freeHeadline: '{days}-day free trial with every feature',
  freeBullets: [
    'Every current feature is included',
    'No card required to start',
    'The clinic is read-only after the trial ends',
  ],
  fullHeadline: 'Full access to every feature, billed monthly',
  fullBullets: [
    'The same features as the trial, while the subscription is paid',
    'The monthly price is the saved regional price',
  ],
};

function parseBullets(raw: string, name: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid input', [`${name} must be a list of short lines`]);
  }
  return requireBullets(parsed, name);
}

export function requireBullets(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new ValidationError('Invalid input', [`${name} must contain 1 to 8 lines`]);
  }
  return value.map((item, index) => requireString(item, `${name} ${index + 1}`, { min: 1, max: 120 }));
}

export function parseTrialDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 90) {
    throw new ValidationError('Invalid input', ['trialDays must be a whole number from 1 to 90']);
  }
  return value;
}

function fromRow(row: OfferRow): PlanOffer {
  return {
    trialDays: Number(row.trial_days),
    trialLimitations: row.trial_limitations,
    freeHeadline: row.free_headline,
    freeBullets: parseBullets(row.free_bullets, 'freeBullets'),
    fullHeadline: row.full_headline,
    fullBullets: parseBullets(row.full_bullets, 'fullBullets'),
  };
}

export async function loadPlanOffer(db: Pool, logger?: Logger): Promise<PlanOffer> {
  const [rows] = await db.query<OfferRow[]>(
    `SELECT trial_days, trial_limitations, free_headline, free_bullets, full_headline, full_bullets
     FROM plan_offer WHERE id = 1`,
  );
  const row = rows[0];
  if (row === undefined) {
    logger?.warn('plan offer row is missing; using the seed defaults');
    return { ...SEED_OFFER, freeBullets: [...SEED_OFFER.freeBullets], fullBullets: [...SEED_OFFER.fullBullets] };
  }
  return fromRow(row);
}

export function offerFromBody(body: Record<string, unknown>): PlanOffer {
  return {
    trialDays: parseTrialDays(body.trialDays),
    trialLimitations: requireString(body.trialLimitations, 'trialLimitations', { min: 1, max: 500 }),
    freeHeadline: requireString(body.freeHeadline, 'freeHeadline', { min: 1, max: 160 }),
    freeBullets: requireBullets(body.freeBullets, 'freeBullets'),
    fullHeadline: requireString(body.fullHeadline, 'fullHeadline', { min: 1, max: 160 }),
    fullBullets: requireBullets(body.fullBullets, 'fullBullets'),
  };
}

export async function savePlanOffer(db: Pool, body: Record<string, unknown>): Promise<PlanOffer> {
  const offer = offerFromBody(body);
  const params = [
    offer.trialDays,
    offer.trialLimitations,
    offer.freeHeadline,
    JSON.stringify(offer.freeBullets),
    offer.fullHeadline,
    JSON.stringify(offer.fullBullets),
  ];
  const [updated] = await db.query<ResultSetHeader>(
    `UPDATE plan_offer
     SET trial_days = ?, trial_limitations = ?, free_headline = ?, free_bullets = ?,
         full_headline = ?, full_bullets = ?
     WHERE id = 1`,
    params,
  );
  if (updated.affectedRows === 0) {
    await db.query(
      `INSERT INTO plan_offer (
         id, trial_days, trial_limitations, free_headline, free_bullets, full_headline, full_bullets
       ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      params,
    );
  }
  return offer;
}
