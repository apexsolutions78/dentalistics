import type { SessionUser } from './types';

export function accountIdentity(
  user: Pick<SessionUser, 'email' | 'displayName' | 'organizationId'>,
  organizationName: string | null,
): { name: string; detail: string; initial: string } {
  const named = user.displayName?.trim() ?? '';
  const local = user.email.split('@')[0]?.trim() ?? '';
  let name = user.email;
  if (named.length > 0) {
    name = named;
  } else if (local.length > 0) {
    name = local;
  }
  const detail = user.organizationId === null ? 'Platform admin' : (organizationName?.trim() ?? '');
  const initial = (name[0] ?? '?').toUpperCase();
  return { name, detail, initial };
}
