import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  normalizePhone,
  optionalEmail,
  parseDateOnly,
  parseListParams,
  requireChoice,
} from '../src/validate';

function expectIssue(fn: () => unknown, snippet: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.join(' | ')).toContain(snippet);
    return;
  }
  throw new Error('expected function to throw ValidationError');
}

describe('normalizePhone', () => {
  it('accepts and normalizes common formats to digits', () => {
    expect(normalizePhone('+9731234567')).toBe('9731234567');
    expect(normalizePhone('973 123 4567')).toBe('9731234567');
    expect(normalizePhone('(01) 234-5678')).toBe('012345678');
    expect(normalizePhone('12345.6789')).toBe('123456789');
  });

  it('rejects invalid values', () => {
    expectIssue(() => normalizePhone('123'), '7-15 digits');
    expectIssue(() => normalizePhone('abcdefghij'), '7-15 digits');
    expectIssue(() => normalizePhone('+1234567890123456'), '7-15 digits');
    expectIssue(() => normalizePhone(12345678), 'must be a string');
  });
});

describe('optionalEmail', () => {
  it('passes through valid emails and normalizes empty', () => {
    expect(optionalEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(optionalEmail(undefined)).toBeNull();
    expect(optionalEmail(null)).toBeNull();
    expect(optionalEmail('')).toBeNull();
    expectIssue(() => optionalEmail('not-an-email'), 'valid email');
  });
});

describe('parseDateOnly', () => {
  it('accepts real dates', () => {
    expect(parseDateOnly('2026-09-27', 'from')).toBe('2026-09-27');
    expect(parseDateOnly('2026-02-28', 'from')).toBe('2026-02-28');
  });

  it('rejects malformed and impossible dates', () => {
    expectIssue(() => parseDateOnly('27-09-2026', 'from'), 'YYYY-MM-DD');
    expectIssue(() => parseDateOnly('2026-02-30', 'from'), 'real calendar');
    expectIssue(() => parseDateOnly('2026-13-01', 'from'), 'real calendar');
  });
});

describe('parseListParams', () => {
  it('defaults to limit 50, offset 0', () => {
    expect(parseListParams({})).toEqual({ limit: 50, offset: 0 });
  });

  it('parses valid values', () => {
    expect(parseListParams({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 });
  });

  it('rejects out-of-range values', () => {
    expectIssue(() => parseListParams({ limit: '0' }), 'between 1 and 100');
    expectIssue(() => parseListParams({ limit: '101' }), 'between 1 and 100');
    expectIssue(() => parseListParams({ limit: 'abc' }), 'between 1 and 100');
    expectIssue(() => parseListParams({ offset: '-1' }), 'non-negative');
  });
});

describe('requireChoice', () => {
  it('accepts listed values and rejects others', () => {
    expect(requireChoice('NEW', ['NEW', 'CLOSED'], 'status')).toBe('NEW');
    expectIssue(() => requireChoice('DONE', ['NEW', 'CLOSED'], 'status'), 'status must be one of');
    expectIssue(() => requireChoice(42, ['NEW'], 'status'), 'status must be one of');
  });
});
