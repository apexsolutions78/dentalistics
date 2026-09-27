import { ValidationError } from './errors';

export { ValidationError };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', ['email must be a string']);
  }
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new ValidationError('Invalid input', ['email must be a valid email address']);
  }
  return email;
}

export function requireString(
  value: unknown,
  name: string,
  options: { min?: number; max?: number } = {},
): string {
  const min = options.min ?? 1;
  const max = options.max ?? 255;
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', [`${name} must be a string`]);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new ValidationError('Invalid input', [
      `${name} must be between ${min} and ${max} characters`,
    ]);
  }
  return trimmed;
}

export function requirePassword(value: unknown, name = 'password'): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', [`${name} must be a string`]);
  }
  if (value.length < 12 || value.length > 200) {
    throw new ValidationError('Invalid input', [
      `${name} must be between 12 and 200 characters`,
    ]);
  }
  return value;
}

export function requireRole(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError('Invalid input', [
      `role must be one of: ${allowed.join(', ')}`,
    ]);
  }
  return value;
}

export function requireChoice(value: unknown, allowed: readonly string[], name: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new ValidationError('Invalid input', [
      `${name} must be one of: ${allowed.join(', ')}`,
    ]);
  }
  return value;
}

const PHONE_STRIP = /[\s\-().]/g;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export function normalizePhone(value: unknown, name = 'phone'): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', [`${name} must be a string`]);
  }
  const cleaned = value.replace(PHONE_STRIP, '');
  if (!PHONE_PATTERN.test(cleaned)) {
    throw new ValidationError('Invalid input', [
      `${name} must be 7-15 digits with an optional leading +`,
    ]);
  }
  return cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
}

export function optionalEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return normalizeEmail(value);
}

export function optionalText(
  value: unknown,
  name: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid input', [`${name} must be a string`]);
  }
  if (value.length > maxLength) {
    throw new ValidationError('Invalid input', [`${name} must be at most ${maxLength} characters`]);
  }
  return value;
}

export function optionalUserId(value: unknown, name: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError('Invalid input', [`${name} must be a positive integer or null`]);
  }
  return value;
}

export function parseDateOnly(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('Invalid input', [`${name} must be a date in YYYY-MM-DD format`]);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('Invalid input', [`${name} must be a real calendar date`]);
  }
  return value;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function parseTimeOnly(value: unknown, name: string): string {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new ValidationError('Invalid input', [
      `${name} must be a time in HH:MM or HH:MM:SS format`,
    ]);
  }
  return value.length === 5 ? `${value}:00` : value;
}

export function parseTimezone(value: unknown, name = 'timezone'): string {
  const tz = requireString(value, name, { min: 1, max: 64 });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new ValidationError('Invalid input', [
      `${name} must be a valid IANA timezone (e.g. Asia/Bahrain)`,
    ]);
  }
  return tz;
}

export function parseListParams(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = query.limit;
  const rawOffset = query.offset;
  let limit = 50;
  let offset = 0;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new ValidationError('Invalid input', ['limit must be an integer between 1 and 100']);
    }
    limit = parsed;
  }
  if (rawOffset !== undefined) {
    const parsed = Number(rawOffset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ValidationError('Invalid input', ['offset must be a non-negative integer']);
    }
    offset = parsed;
  }
  return { limit, offset };
}

export function parsePathId(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError('Invalid input', ['id must be a positive integer']);
  }
  return value;
}
