import type { Role, SessionUser } from './types';

const MANAGER_CAPABILITIES = [
  'dashboard.view',
  'leads.view',
  'leads.create',
  'leads.edit',
  'leads.notes.edit',
  'patients.view',
  'patients.create',
  'patients.edit',
  'appointments.view',
  'appointments.create',
  'appointments.edit',
  'appointments.reschedule',
  'appointments.rebook',
  'communications.view',
  'communications.send',
  'automations.view',
  'automations.manage',
  'automations.activity.view',
  'recall.view',
  'recall.manage',
  'settings.view',
  'settings.clinic.manage',
  'settings.users.manage',
  'settings.communication.manage',
  'settings.templates.manage',
  'settings.appointments.manage',
  'settings.recall.manage',
  'settings.reviews.manage',
  'settings.automation.manage',
  'admin.webhooks.view',
  'admin.automation_failures.view',
  'admin.audit.view',
] as const;

export type Capability = (typeof MANAGER_CAPABILITIES)[number];

const RECEPTIONIST_CAPABILITIES: readonly Capability[] = [
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

export const CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: MANAGER_CAPABILITIES,
  admin: MANAGER_CAPABILITIES,
  receptionist: RECEPTIONIST_CAPABILITIES,
};

export function can(user: SessionUser | null, capability: Capability): boolean {
  if (user === null) return false;
  return CAPABILITIES[user.role].includes(capability);
}
