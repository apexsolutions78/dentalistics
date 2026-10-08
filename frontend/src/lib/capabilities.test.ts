import { describe, expect, it } from 'vitest';
import { CAPABILITIES, can, type Capability } from './capabilities';
import { makeUser } from '../test/fixtures';

const ALL: readonly Capability[] = CAPABILITIES.owner;

describe('capability map', () => {
  it('gives owners the full set and admins the extra trials screen', () => {
    expect(CAPABILITIES.owner).toEqual(ALL);
    expect(CAPABILITIES.admin).toEqual([...ALL, 'admin.trials.view', 'admin.payments.view']);
    expect(ALL.length).toBe(34);
    expect(can(makeUser({ role: 'owner' }), 'admin.trials.view')).toBe(false);
    expect(can(makeUser({ role: 'admin' }), 'admin.trials.view')).toBe(true);
    expect(can(makeUser({ role: 'owner' }), 'admin.payments.view')).toBe(false);
    expect(can(makeUser({ role: 'admin' }), 'admin.payments.view')).toBe(true);
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
      'admin.trials.view',
      'admin.payments.view',
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
      'doctors.view',
      'doctors.manage',
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
