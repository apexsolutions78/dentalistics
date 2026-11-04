import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../src/automation/time';
import {
  billingGraceDays,
  describeBilling,
  readOnlyOrganizationPredicate,
  renewalNoticeDays,
} from '../src/billing/subscription';
import {
  classifiedDatetimeColumns,
  columnKey,
  DO_NOT_SHIFT_COLUMNS,
  LOCAL_WALL_CLOCK_COLUMNS,
} from '../src/db/localTimestamps';

describe('clinic timezone conversion', () => {
  it('converts Asia/Karachi wall time to UTC without using the server zone', () => {
    const utc = zonedToUtc('2026-11-04', '07:34:00', 'Asia/Karachi');
    expect(utc.toISOString()).toBe('2026-11-04T02:34:00.000Z');
  });
});

describe('subscription phase', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const graceDays = 3;
  const noticeDays = 7;

  it('keeps an active paid period writable until the notice window', () => {
    const described = describeBilling({
      plan: 'full',
      trialEndsAt: null,
      paidUntil: new Date('2026-07-15T12:00:00.000Z'),
      now,
      graceDays,
      noticeDays,
    });
    expect(described.phase).toBe('active');
    expect(described.readOnly).toBe(false);
  });

  it('marks renewal due inside the notice window and grace after paid_until', () => {
    const due = describeBilling({
      plan: 'full',
      trialEndsAt: null,
      paidUntil: new Date('2026-06-20T12:00:00.000Z'),
      now,
      graceDays,
      noticeDays,
    });
    expect(due.phase).toBe('renewal_due');
    expect(due.readOnly).toBe(false);

    const grace = describeBilling({
      plan: 'full',
      trialEndsAt: null,
      paidUntil: new Date('2026-06-14T12:00:00.000Z'),
      now,
      graceDays,
      noticeDays,
    });
    expect(grace.phase).toBe('grace');
    expect(grace.readOnly).toBe(false);
  });

  it('locks only after the grace period and leaves a null paid_until unmetered', () => {
    const expired = describeBilling({
      plan: 'full',
      trialEndsAt: null,
      paidUntil: new Date('2026-06-10T12:00:00.000Z'),
      now,
      graceDays,
      noticeDays,
    });
    expect(expired.phase).toBe('expired');
    expect(expired.readOnly).toBe(true);

    const open = describeBilling({
      plan: 'full',
      trialEndsAt: null,
      paidUntil: null,
      now,
      graceDays,
      noticeDays,
    });
    expect(open.phase).toBe('unmetered');
    expect(open.readOnly).toBe(false);
  });

  it('reads grace and notice days from the environment', () => {
    expect(billingGraceDays({} as NodeJS.ProcessEnv)).toBe(3);
    expect(renewalNoticeDays({ BILLING_RENEWAL_NOTICE_DAYS: '10' } as NodeJS.ProcessEnv)).toBe(10);
    expect(() => billingGraceDays({ BILLING_GRACE_DAYS: 'nope' } as NodeJS.ProcessEnv)).toThrow(
      /BILLING_GRACE_DAYS/,
    );
  });

  it('rejects an unsafe column expression in the automation predicate', () => {
    expect(readOnlyOrganizationPredicate('m.organization_id', 3)).toContain('INTERVAL 3 DAY');
    expect(() => readOnlyOrganizationPredicate('organization_id; drop table organizations', 3)).toThrow(
      /Unsafe/,
    );
  });
});

describe('timestamp correction classification', () => {
  it('classifies each tracked datetime column once and keeps UTC instants unshifted', () => {
    const keys = classifiedDatetimeColumns();
    const shifted = new Set(LOCAL_WALL_CLOCK_COLUMNS.map(columnKey));
    expect(keys.has('appointment_reminders.scheduled_at')).toBe(true);
    expect(shifted.has('appointment_reminders.scheduled_at')).toBe(false);
    expect(shifted.has('organizations.trial_ends_at')).toBe(false);
    expect(shifted.has('organizations.paid_until')).toBe(false);
    expect(shifted.has('organizations.created_at')).toBe(true);
    expect(keys.has('leads.last_activity_at')).toBe(true);
    expect(DO_NOT_SHIFT_COLUMNS.map(columnKey)).toContain('communication_messages.sent_at');
  });
});
