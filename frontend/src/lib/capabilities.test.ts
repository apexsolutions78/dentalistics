import { describe, expect, it } from 'vitest';
import { CAPABILITIES, can, type Capability } from './capabilities';
import { makeUser } from '../test/fixtures';

const ALL: readonly Capability[] = CAPABILITIES.owner;

describe('capability map', () => {
  it('gives owners and admins the full capability set', () => {
    expect(CAPABILITIES.owner).toEqual(ALL);
    expect(CAPABILITIES.admin).toEqual(ALL);
    expect(ALL.length).toBe(32);
  });

  it('keeps receptionists on member-facing capabilities only', () => {
    const denied: Capability[] = [
      'dashboard.view',
      'automations.view',
      'automations.activity.view',
      'automations.manage',
      'settings.view',
      'settings.users.manage',
      'admin.webhooks.view',
      'admin.automation_failures.view',
      'admin.audit.view',
      'patients.create',
      'patients.edit',
      'appointments.edit',
      'appointments.reschedule',
      'recall.manage',
      'leads.notes.edit',
    ];
    for (const capability of denied) {
      expect(can(makeUser({ role: 'receptionist' }), capability)).toBe(false);
    }

    const allowed: Capability[] = [
      'leads.view',
      'leads.create',
      'leads.edit',
      'patients.view',
      'appointments.view',
      'appointments.create',
      'appointments.rebook',
      'communications.view',
      'recall.view',
    ];
    for (const capability of allowed) {
      expect(can(makeUser({ role: 'receptionist' }), capability)).toBe(true);
    }
  });

  it('denies every capability to signed-out users', () => {
    expect(can(null, 'dashboard.view')).toBe(false);
    expect(can(null, 'settings.view')).toBe(false);
  });
});
