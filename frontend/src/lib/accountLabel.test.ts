import { describe, expect, it } from 'vitest';
import { accountIdentity } from './accountLabel';

describe('accountIdentity', () => {
  it('uses the saved name and the clinic name', () => {
    expect(
      accountIdentity(
        { email: 'owner@harbourview.dental', displayName: 'Avery Owner', organizationId: 4 },
        'Harbour View Dental',
      ),
    ).toEqual({ name: 'Avery Owner', detail: 'Harbour View Dental', initial: 'A' });
  });

  it('falls back to the email local-part when no name is set', () => {
    expect(
      accountIdentity(
        { email: 'desk@harbourview.dental', displayName: '  ', organizationId: 4 },
        'Harbour View Dental',
      ).name,
    ).toBe('desk');
  });

  it('labels a platform administrator who has no clinic', () => {
    expect(
      accountIdentity(
        { email: 'admin@dentalistics.test', displayName: null, organizationId: null },
        null,
      ),
    ).toEqual({ name: 'admin', detail: 'Platform admin', initial: 'A' });
  });
});
