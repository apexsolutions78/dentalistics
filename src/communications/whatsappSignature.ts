import { createHmac, timingSafeEqual } from 'node:crypto';

export const WHATSAPP_SIGNATURE_HEADER = 'x-hub-signature-256';

const SHA256_PREFIX = 'sha256=';

export function verifyWhatsappSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (rawBody === undefined || rawBody.length === 0) {
    return false;
  }
  if (appSecret === '') {
    return false;
  }
  if (typeof header !== 'string' || !header.startsWith(SHA256_PREFIX)) {
    return false;
  }
  const provided = header.slice(SHA256_PREFIX.length);
  if (!/^[0-9a-fA-F]+$/.test(provided)) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(provided.toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function timingSafeEqualStrings(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}
