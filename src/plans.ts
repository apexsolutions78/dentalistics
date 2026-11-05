/** New signups only. Existing organizations.trial_ends_at values are not rewritten. */
export const TRIAL_DAYS = 14;

export interface PublicPlan {
  id: 'trial' | 'full';
  name: string;
  headline: string;
  /** Saved United States amount, in cents. Null when that row is missing. */
  priceUsdCents: number | null;
  interval: 'trial' | 'month';
  trialDays: number | null;
}

export const DEFAULT_PRICE_REGION = 'us';
export const DEFAULT_PRICE_CURRENCY = 'USD';

export const PLANS: readonly PublicPlan[] = [
  {
    id: 'trial',
    name: 'Free Plan',
    headline: '14-day free trial with every feature',
    priceUsdCents: 0,
    interval: 'trial',
    trialDays: TRIAL_DAYS,
  },
  {
    id: 'full',
    name: 'Full Plan',
    headline: 'Full access to every feature, billed monthly',
    priceUsdCents: null,
    interval: 'month',
    trialDays: null,
  },
] as const;

export function savedUsdMinor(
  regions: readonly { code: string; currency: string; amountMinor: number }[],
): number | null {
  const usd = regions.find(
    (region) => region.code === DEFAULT_PRICE_REGION && region.currency === DEFAULT_PRICE_CURRENCY,
  );
  const amount = usd === undefined ? Number.NaN : Number(usd.amountMinor);
  if (!Number.isInteger(amount) || amount < 1) {
    return null;
  }
  return amount;
}

export function plansForPublic(
  regions: readonly { code: string; currency: string; amountMinor: number }[],
): PublicPlan[] {
  const priceUsdCents = savedUsdMinor(regions);
  return PLANS.map((plan) =>
    plan.id === 'full' ? { ...plan, priceUsdCents } : { ...plan },
  );
}
