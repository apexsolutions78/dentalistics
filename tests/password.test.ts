import { describe, expect, it } from 'vitest';
import {
  getDummyHash,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from '../src/auth/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const stored = await hashPassword('a-strong-enough-password');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassword('a-strong-enough-password', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('a-strong-enough-password');
    await expect(verifyPassword('wrong-password-here', stored)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const one = await hashPassword('same-password-value');
    const two = await hashPassword('same-password-value');
    expect(one).not.toBe(two);
    await expect(verifyPassword('same-password-value', two)).resolves.toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$16384$8$1$$')).resolves.toBe(false);
  });

  it('rejects a tampered hash', async () => {
    const stored = await hashPassword('a-strong-enough-password');
    const tampered = `${stored.slice(0, -4)}AAAA`;
    await expect(verifyPassword('a-strong-enough-password', tampered)).resolves.toBe(false);
  });

  it('exposes a minimum password length of 12', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('provides a stable dummy hash for timing equalization', async () => {
    const first = await getDummyHash();
    const second = await getDummyHash();
    expect(first).toBe(second);
    await expect(verifyPassword('anything', first)).resolves.toBe(false);
  });
});
