import { describe, expect, it } from 'vitest';
import { createRateLimiter, LOGIN_RATE_LIMIT } from '../src/security/rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit and blocks the next attempt', () => {
    let time = 1_000_000;
    const limiter = createRateLimiter(3, 60_000, () => time);
    expect(limiter.check('k')).toBe(true);
    expect(limiter.check('k')).toBe(true);
    expect(limiter.check('k')).toBe(true);
    expect(limiter.check('k')).toBe(false);
    time += 60_001;
    expect(limiter.check('k')).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter(1, 60_000, () => 0);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('b')).toBe(true);
  });

  it('uses the documented login limit', () => {
    expect(LOGIN_RATE_LIMIT).toBe(10);
  });
});
