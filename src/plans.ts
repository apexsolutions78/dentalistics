/** New signups only. Existing organizations.trial_ends_at values are not rewritten. */
export const TRIAL_DAYS = 14;

export interface PublicPlan {
  id: 'trial' | 'full';
  name: string;
  headline: string;
  priceUsdCents: number;
  interval: 'trial' | 'month';
  trialDays: number | null;
}

/** Fallback only. The public page uses the saved United States row when it exists. */
export const FALLBACK_FULL_PRICE_USD_CENTS = 2000;

export const DEFAULT_PRICE_REGION = 'us';

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
    priceUsdCents: FALLBACK_FULL_PRICE_USD_CENTS,
    interval: 'month',
    trialDays: null,
  },
] as const;

export function plansForPublic(
  regions: readonly { code: string; currency: string; amountMinor: number }[],
): PublicPlan[] {
  const usd = regions.find(
    (region) => region.code === DEFAULT_PRICE_REGION && region.currency === 'USD',
  );
  const amount = usd === undefined ? Number.NaN : Number(usd.amountMinor);
  const priceUsdCents =
    Number.isInteger(amount) && amount > 0 ? amount : FALLBACK_FULL_PRICE_USD_CENTS;
  return PLANS.map((plan) =>
    plan.id === 'full' ? { ...plan, priceUsdCents } : { ...plan },
  );
}
