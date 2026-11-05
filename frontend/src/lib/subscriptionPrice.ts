import type { PublicPlan, RegionalPrice } from './types';
import { formatMinor } from './money';

export const CONTACT_FOR_PRICE = 'Contact us';

export function savedUsdRegion(regions: readonly RegionalPrice[]): RegionalPrice | null {
  const usd = regions.find((region) => region.code === 'us' && region.currency === 'USD');
  if (usd === undefined || !Number.isInteger(Number(usd.amountMinor)) || Number(usd.amountMinor) < 1) {
    return null;
  }
  return usd;
}

/** Matching region, otherwise the saved USD price. Never invents an amount. */
export function priceForVisitor(
  regions: readonly RegionalPrice[],
  regionCode: string,
): RegionalPrice | null {
  const selected = regions.find((region) => region.code === regionCode);
  if (
    selected !== undefined &&
    Number.isInteger(Number(selected.amountMinor)) &&
    Number(selected.amountMinor) > 0
  ) {
    return selected;
  }
  return savedUsdRegion(regions);
}

export function formatSavedAmount(region: RegionalPrice | null, usdCents: number | null): string {
  if (region !== null) {
    return formatMinor(Number(region.amountMinor), region.currency);
  }
  if (usdCents !== null && Number.isInteger(usdCents) && usdCents > 0) {
    return formatMinor(usdCents, 'USD');
  }
  return CONTACT_FOR_PRICE;
}

export function fullPlanAmount(
  plan: PublicPlan,
  regions: readonly RegionalPrice[],
  regionCode: string,
): string {
  if (plan.id !== 'full') {
    return formatMinor(plan.priceUsdCents ?? 0, 'USD');
  }
  return formatSavedAmount(priceForVisitor(regions, regionCode), plan.priceUsdCents);
}
