import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeSignature(secret: string, fullUrl: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let payload = fullUrl;
  for (const key of keys) {
    payload += `${key}${params[key]}`;
  }
  return createHmac('sha1', secret).update(payload, 'utf8').digest('base64');
}

export function verifySignature(
  secret: string,
  fullUrl: string,
  params: Record<string, string>,
  headerValue: string | undefined,
): boolean {
  if (headerValue === undefined || headerValue === '') {
    return false;
  }
  const expected = computeSignature(secret, fullUrl, params);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(headerValue, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
