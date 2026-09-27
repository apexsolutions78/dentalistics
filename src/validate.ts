import { ValidationError } from './errors';

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

export function parsePathId(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError('Invalid input', ['id must be a positive integer']);
  }
  return value;
}
