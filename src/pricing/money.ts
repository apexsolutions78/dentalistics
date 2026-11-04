import { ValidationError } from '../errors';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const REGION_CODE_PATTERN = /^[a-z]{2,8}$/;

export function parseCurrency(value: unknown): string {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    throw new ValidationError('Invalid input', ['currency must be a 3-letter ISO code']);
  }
  return value;
}

export function parseRegionCode(value: unknown): string {
  if (typeof value !== 'string' || !REGION_CODE_PATTERN.test(value)) {
    throw new ValidationError('Invalid input', ['region code must be 2-8 lowercase letters']);
  }
  return value;
}

/** Minor units (cents, fils, paisa). The admin screen converts major amounts before sending. */
export function parseAmountMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100_000_000) {
    throw new ValidationError('Invalid input', [
      'amountMinor must be an integer from 1 to 100000000',
    ]);
  }
  return value;
}

export function majorToMinor(major: string): number {
  const trimmed = major.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new ValidationError('Invalid input', ['amount must be a number with at most 2 decimal places']);
  }
  const [whole, frac = ''] = trimmed.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return parseAmountMinor(minor);
}
