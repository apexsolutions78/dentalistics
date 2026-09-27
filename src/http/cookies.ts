export const SESSION_COOKIE_NAME = 'sid';
export const SESSION_TTL_HOURS = 12;

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (header === undefined || header === '') {
    return result;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key !== '' && result[key] === undefined) {
      result[key] = decodeURIComponent(value);
    }
  }
  return result;
}

export function buildSessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearCookie(secure: boolean): string {
  return buildSessionCookie('', secure, 0);
}
