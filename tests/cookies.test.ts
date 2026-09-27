import { describe, expect, it } from 'vitest';
import {
  buildClearCookie,
  buildSessionCookie,
  parseCookieHeader,
} from '../src/http/cookies';

describe('parseCookieHeader', () => {
  it('parses a single cookie', () => {
    expect(parseCookieHeader('sid=abc123')).toEqual({ sid: 'abc123' });
  });

  it('parses multiple cookies and ignores malformed parts', () => {
    expect(parseCookieHeader('sid=abc; other=x; broken; =nope')).toEqual({
      sid: 'abc',
      other: 'x',
    });
  });

  it('keeps the first occurrence of a duplicated key', () => {
    expect(parseCookieHeader('sid=first; sid=second')).toEqual({ sid: 'first' });
  });

  it('url-decodes values', () => {
    expect(parseCookieHeader('sid=a%20b')).toEqual({ sid: 'a b' });
  });

  it('handles missing headers', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });
});

describe('buildSessionCookie', () => {
  it('sets HttpOnly, SameSite=Lax, Path and Max-Age without Secure by default', () => {
    const cookie = buildSessionCookie('tok', false, 43200);
    expect(cookie).toContain('sid=tok');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie).not.toContain('Secure');
  });

  it('adds Secure when requested', () => {
    expect(buildSessionCookie('tok', true, 43200)).toContain('Secure');
  });

  it('clears with Max-Age=0', () => {
    const cookie = buildClearCookie(false);
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).not.toContain('Secure');
  });
});
