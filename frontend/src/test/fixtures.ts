import { vi } from 'vitest';
import type { MemberUser, PublicPlan, SessionOrganization, SessionUser, Settings } from '../lib/types';

export function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 1,
    email: 'owner@example.com',
    role: 'owner',
    organizationId: 1,
    ...overrides,
  };
}

export function makeOrganization(
  overrides: Partial<SessionOrganization> = {},
): SessionOrganization {
  return {
    id: 1,
    name: 'Test Clinic',
    plan: 'full',
    trialEndsAt: null,
    onboardingCompletedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

export function makePlans(): PublicPlan[] {
  return [
    {
      id: 'trial',
      name: 'Free Plan',
      headline: '8-day free trial with every feature',
      priceUsdCents: 0,
      interval: 'trial',
      trialDays: 8,
    },
    {
      id: 'full',
      name: 'Full Plan',
      headline: 'Full access to every feature, $20 per month',
      priceUsdCents: 2000,
      interval: 'month',
      trialDays: null,
    },
  ];
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  const base: Settings = {
    clinic: {
      name: 'Test Clinic',
      phone: '97312345678',
      email: 'clinic@example.com',
      address: '123 Main St',
      logoUrl: null,
      businessHours: {
        mon: { open: '09:00', close: '17:00' },
        tue: { open: '09:00', close: '17:00' },
        wed: { open: '09:00', close: '17:00' },
        thu: { open: '09:00', close: '17:00' },
        fri: { open: '09:00', close: '17:00' },
        sat: null,
        sun: null,
      },
      timezone: 'Asia/Bahrain',
      reviewUrl: null,
    },
    automations: {
      reminder: {
        config: {
          enabled: true,
          channel: 'SMS',
          provider: 'mock',
          offsetsHours: [48, 24, 2],
          quietHours: { enabled: false, start: '21:00', end: '08:00' },
          templates: { '48': 'r48', '24': 'r24', '2': 'r2' },
          maxAttempts: 3,
        },
        source: 'default',
      },
      noShow: {
        config: {
          enabled: true,
          channel: 'SMS',
          provider: 'mock',
          followUpDelayHours: 24,
          templates: { initial: 'ns1', followUp: 'ns2' },
          maxAttempts: 3,
        },
        source: 'default',
      },
      recall: {
        config: {
          enabled: true,
          channel: 'SMS',
          provider: 'mock',
          intervalDays: 180,
          followUpDelayHours: 48,
          templates: { recall: 'rc1', followUp: 'rc2' },
          maxAttempts: 3,
        },
        source: 'default',
      },
      review: {
        config: {
          enabled: true,
          channel: 'SMS',
          provider: 'mock',
          delayHours: 24,
          suppressionPeriodDays: 90,
          template: 'rv1',
          maxAttempts: 3,
        },
        source: 'default',
      },
      leadAck: {
        config: { enabled: true, channel: 'SMS', provider: 'mock', sources: ['WEBSITE'], template: 'ack' },
        source: 'default',
      },
      missedCall: {
        config: { enabled: true, channel: 'SMS', provider: 'mock', template: 'mc' },
        source: 'default',
      },
      leadAutomation: {
        config: {
          enabled: true,
          highKeywords: ['emergency', 'pain', 'broken', 'bleeding'],
          highSources: ['MISSED_CALL'],
          staleHours: 24,
          slotsCount: 3,
          lookaheadDays: 7,
          slaDays: { high: 2, medium: 5, low: 7 },
          channel: 'SMS',
          provider: 'mock',
          template: 'appt',
        },
        source: 'default',
      },
    },
    providers: {
      telephony: { enabled: false, configured: { signingSecret: false }, source: 'default' },
      whatsapp: {
        enabled: false,
        configured: { verifyToken: false, appSecret: false, accessToken: false },
        graph: { phoneNumberId: '', apiVersion: 'v20.0' },
        source: 'default',
      },
    },
    templates: {
      lead_acknowledgement: 'ack',
      missed_call_response: 'mc',
      appointment_confirmation: 'appt',
      appointment_reminder_48h: 'r48',
      appointment_reminder_24h: 'r24',
      appointment_reminder_2h: 'r2',
      no_show_message: 'ns1',
      no_show_follow_up: 'ns2',
      recall_message: 'rc1',
      recall_follow_up: 'rc2',
      review_request: 'rv1',
    },
    definitions: {
      automationKeys: ['reminder', 'noShow', 'recall', 'review', 'leadAck', 'missedCall', 'leadAutomation'],
      providerKeys: ['telephony', 'whatsapp'],
      deploymentGlobal: { automations: ['maxAttempts'], note: 'attempt cap is deployment-wide' },
      templateNames: [
        'lead_acknowledgement',
        'missed_call_response',
        'appointment_confirmation',
        'appointment_reminder_48h',
        'appointment_reminder_24h',
        'appointment_reminder_2h',
        'no_show_message',
        'no_show_follow_up',
        'recall_message',
        'recall_follow_up',
        'review_request',
      ],
      templateVariables: [
        { name: 'first_name', source: 'automation context' },
        { name: 'clinic_name', source: 'organization.name' },
        { name: 'appointment_date', source: 'automation context' },
        { name: 'appointment_time', source: 'automation context' },
        { name: 'clinic_phone', source: 'organization.phone' },
        { name: 'booking_link', source: null },
      ],
      roleMatrix: { owner: ['settings.manage'], receptionist: ['appointments.work'] },
      businessHourDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      clinicFields: ['name', 'phone', 'email', 'address', 'logoUrl', 'businessHours', 'timezone', 'reviewUrl'],
    },
  };
  return { ...base, ...overrides };
}

export function makeMembers(): MemberUser[] {
  return [
    { id: 1, email: 'owner@example.com', role: 'owner', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-09-01T00:00:00.000Z' },
    { id: 2, email: 'desk@example.com', role: 'receptionist', status: 'active', createdAt: '2026-01-02T00:00:00.000Z', lastLoginAt: null },
  ];
}

export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

export type FetchRoute = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function mockFetch(routes: FetchRoute): void {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(routes(String(input), init)),
  );
  vi.stubGlobal('fetch', fn);
}
