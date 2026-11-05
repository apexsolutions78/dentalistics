import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { savedUsdRegion } from '../lib/subscriptionPrice';
import { formatMinor } from '../lib/money';
import type { PublicPlan, RegionalPrice } from '../lib/types';

export function SubscriptionPriceLine() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ plans: PublicPlan[]; regions?: RegionalPrice[] }>('/api/public/plans')
      .then((res) => {
        if (cancelled) return;
        const trial = res.plans.find((plan) => plan.id === 'trial');
        const usd = savedUsdRegion(res.regions ?? []);
        const cents = res.plans.find((plan) => plan.id === 'full')?.priceUsdCents ?? null;
        const price =
          usd !== null
            ? formatMinor(Number(usd.amountMinor), usd.currency)
            : cents !== null && cents > 0
              ? formatMinor(cents, 'USD')
              : null;
        const days = trial?.trialDays ?? null;
        if (days !== null && price !== null) {
          setText(
            `${days}-day trial, then ${price} per month. ${trial?.limitations ?? ''}`.trim(),
          );
          return;
        }
        if (days !== null) {
          setText(`${days}-day trial. Contact us for monthly pricing.`);
          return;
        }
        setText('Contact us for the trial and monthly price.');
      })
      .catch(() => {
        if (!cancelled) setText('Contact us for monthly pricing.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (text === null) return null;
  return <p className="sub">{text}</p>;
}
