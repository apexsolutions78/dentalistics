import { randomBytes } from 'node:crypto';

export function generateSiteKey(): string {
  return randomBytes(32).toString('hex');
}
