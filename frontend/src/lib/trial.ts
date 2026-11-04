import type { SessionOrganization } from './types';

export function trialLocked(organization: SessionOrganization | null): boolean {
  if (organization === null || organization.plan !== 'trial') return false;
  if (organization.readOnly === true) return true;
  if (organization.trialEndsAt === null) return false;
  const ends = Date.parse(organization.trialEndsAt);
  return !Number.isNaN(ends) && ends <= Date.now();
}

export function clinicReadOnly(organization: SessionOrganization | null): boolean {
  if (organization === null) return false;
  if (organization.readOnly === true) return true;
  return trialLocked(organization);
}
