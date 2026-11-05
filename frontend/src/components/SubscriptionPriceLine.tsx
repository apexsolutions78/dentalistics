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
        const usd = savedUsdRegion(res.regions ?? []);
        const cents = res.plans.find((plan) => plan.id === 'full')?.priceUsdCents ?? null;
        if (usd !== null) {
          setText(`${formatMinor(Number(usd.amountMinor), usd.currency)} per month after the trial`);
          return;
        }
        if (cents !== null && cents > 0) {
          setText(`${formatMinor(cents, 'USD')} per month after the trial`);
          return;
        }
        setText('Contact us for monthly pricing.');
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
