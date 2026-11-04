export const BILLING_PERIOD_MONTHS = 1;
export const DEFAULT_BILLING_GRACE_DAYS = 3;
export const DEFAULT_RENEWAL_NOTICE_DAYS = 7;
const MAX_BILLING_DAYS = 90;

export type PlanId = 'trial' | 'full';

export type BillingPhase =
  | 'trial'
  | 'trial_expired'
  | 'active'
  | 'renewal_due'
  | 'grace'
  | 'expired'
  | 'unmetered';

export interface BillingDescription {
  phase: BillingPhase;
  readOnly: boolean;
  paidUntil: Date | null;
  graceDays: number;
  noticeDays: number;
}

function boundedDays(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer from 0 to ${MAX_BILLING_DAYS}`);
  }
  const parsed = Number(raw.trim());
  if (parsed > MAX_BILLING_DAYS) {
    throw new Error(`${name} must be an integer from 0 to ${MAX_BILLING_DAYS}`);
  }
  return parsed;
}

export function billingGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  return boundedDays(env.BILLING_GRACE_DAYS, DEFAULT_BILLING_GRACE_DAYS, 'BILLING_GRACE_DAYS');
}

export function renewalNoticeDays(env: NodeJS.ProcessEnv = process.env): number {
  return boundedDays(
    env.BILLING_RENEWAL_NOTICE_DAYS,
    DEFAULT_RENEWAL_NOTICE_DAYS,
    'BILLING_RENEWAL_NOTICE_DAYS',
  );
}

function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 86_400_000);
}

export function describeBilling(input: {
  plan: PlanId;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  now?: Date;
  graceDays?: number;
  noticeDays?: number;
}): BillingDescription {
  const now = input.now ?? new Date();
  const graceDays = input.graceDays ?? billingGraceDays();
  const noticeDays = input.noticeDays ?? renewalNoticeDays();
  const paidUntil = input.paidUntil;

  if (input.plan === 'trial') {
    const expired = input.trialEndsAt !== null && input.trialEndsAt.getTime() <= now.getTime();
    return {
      phase: expired ? 'trial_expired' : 'trial',
      readOnly: expired,
      paidUntil,
      graceDays,
      noticeDays,
    };
  }

  if (paidUntil === null) {
    return { phase: 'unmetered', readOnly: false, paidUntil, graceDays, noticeDays };
  }

  const graceEnds = addDays(paidUntil, graceDays);
  if (now.getTime() >= graceEnds.getTime()) {
    return { phase: 'expired', readOnly: true, paidUntil, graceDays, noticeDays };
  }
  if (now.getTime() >= paidUntil.getTime()) {
    return { phase: 'grace', readOnly: false, paidUntil, graceDays, noticeDays };
  }
  const noticeStarts = addDays(paidUntil, -noticeDays);
  if (noticeDays > 0 && now.getTime() >= noticeStarts.getTime()) {
    return { phase: 'renewal_due', readOnly: false, paidUntil, graceDays, noticeDays };
  }
  return { phase: 'active', readOnly: false, paidUntil, graceDays, noticeDays };
}

/**
 * SQL predicate matching describeBilling().readOnly. orgIdSql must be a
 * trusted column reference such as "organization_id" or "m.organization_id".
 * Grace days are inlined only after they have been parsed as an integer.
 */
export function readOnlyOrganizationPredicate(orgIdSql: string, graceDays = billingGraceDays()): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(orgIdSql)) {
    throw new Error(`Unsafe organization id expression: ${orgIdSql}`);
  }
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > MAX_BILLING_DAYS) {
    throw new Error(`Unsafe grace days: ${graceDays}`);
  }
  return `NOT EXISTS (
    SELECT 1 FROM organizations billing_lock
    WHERE billing_lock.id = ${orgIdSql}
      AND (
        (billing_lock.plan = 'trial'
          AND billing_lock.trial_ends_at IS NOT NULL
          AND billing_lock.trial_ends_at <= UTC_TIMESTAMP())
        OR (billing_lock.plan = 'full'
          AND billing_lock.paid_until IS NOT NULL
          AND billing_lock.paid_until <= UTC_TIMESTAMP() - INTERVAL ${graceDays} DAY)
      )
  )`;
}
