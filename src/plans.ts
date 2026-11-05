/** New signups only. Existing organizations.trial_ends_at values are not rewritten. */

export interface PublicPlan {
  id: 'trial' | 'full';
  name: string;
  headline: string;
  /** Saved United States amount, in cents. Null when that row is missing. */
  priceUsdCents: number | null;
  interval: 'trial' | 'month';
  trialDays: number | null;
  limitations: string | null;
  bullets: string[];
}

export interface PublicPlanOffer {
  trialDays: number;
  trialLimitations: string;
  freeHeadline: string;
  freeBullets: string[];
  fullHeadline: string;
  fullBullets: string[];
}

export const DEFAULT_PRICE_REGION = 'us';
export const DEFAULT_PRICE_CURRENCY = 'USD';

export const PLANS: readonly PublicPlan[] = [
  {
    id: 'trial',
    name: 'Free Plan',
    headline: '',
    priceUsdCents: 0,
    interval: 'trial',
    trialDays: null,
    limitations: null,
    bullets: [],
  },
  {
    id: 'full',
    name: 'Full Plan',
    headline: '',
    priceUsdCents: null,
    interval: 'month',
    trialDays: null,
    limitations: null,
    bullets: [],
  },
] as const;

export function renderPlanHeadline(template: string, trialDays: number): string {
  return template.replaceAll('{days}', String(trialDays));
}

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
  offer: PublicPlanOffer,
): PublicPlan[] {
  const priceUsdCents = savedUsdMinor(regions);
  return PLANS.map((plan) => {
    if (plan.id === 'trial') {
      return {
        ...plan,
        headline: renderPlanHeadline(offer.freeHeadline, offer.trialDays),
        trialDays: offer.trialDays,
        limitations: offer.trialLimitations,
        bullets: [...offer.freeBullets],
      };
    }
    return {
      ...plan,
      headline: offer.fullHeadline,
      priceUsdCents,
      bullets: [...offer.fullBullets],
    };
  });
}
