export const TRIAL_DAYS = 7;

export interface PublicPlan {
  id: 'trial' | 'full';
  name: string;
  headline: string;
  priceUsdCents: number;
  interval: 'trial' | 'month';
  trialDays: number | null;
}

export const PLANS: readonly PublicPlan[] = [
  {
    id: 'trial',
    name: 'Free Plan',
    headline: '7-day free trial with every feature',
    priceUsdCents: 0,
    interval: 'trial',
    trialDays: TRIAL_DAYS,
  },
  {
    id: 'full',
    name: 'Full Plan',
    headline: 'Everything your clinic needs, $20 per month',
    priceUsdCents: 2000,
    interval: 'month',
    trialDays: null,
  },
] as const;
