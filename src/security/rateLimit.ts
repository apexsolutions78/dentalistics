export interface RateLimiter {
  check(key: string): boolean;
}

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 60_000;

export const PUBLIC_LEAD_IP_LIMIT = 30;
export const PUBLIC_LEAD_KEY_LIMIT = 120;
export const PUBLIC_LEAD_RATE_WINDOW_MS = 60_000;

export const TELEPHONY_WEBHOOK_IP_LIMIT = 200;
export const TELEPHONY_WEBHOOK_RATE_WINDOW_MS = 60_000;
export const WHATSAPP_WEBHOOK_IP_LIMIT = 200;
export const WHATSAPP_WEBHOOK_RATE_WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
): RateLimiter {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string): boolean {
      const time = now();
      if (buckets.size > 10_000) {
        for (const [mapKey, bucket] of buckets) {
          if (bucket.resetAt <= time) {
            buckets.delete(mapKey);
          }
        }
      }
      const existing = buckets.get(key);
      if (existing === undefined || existing.resetAt <= time) {
        buckets.set(key, { count: 1, resetAt: time + windowMs });
        return true;
      }
      existing.count += 1;
      return existing.count <= limit;
    },
  };
}
