import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../src/errors';
import { createPaymentGateway } from '../src/payments/registry';
import { DEFAULT_PAYMENT_GATEWAY_CONFIG } from '../src/payments/gatewayConfig';
import { PLANS, plansForPublic } from '../src/plans';
import { parseTrialDays } from '../src/services/planOffer';
import { majorToMinor } from '../src/pricing/money';
import { classifyImportRows, parseCsv, PATIENT_IMPORT_TEMPLATE } from '../src/services/patientImport';

const sampleOffer = {
  trialDays: 12,
  trialLimitations: 'Read-only after the trial ends.',
  freeHeadline: '{days}-day free trial with every feature',
  freeBullets: ['Every feature'],
  fullHeadline: 'Full access, billed monthly',
  fullBullets: ['Paid monthly'],
};

describe('trial length', () => {
  it('does not compile a trial length or a full-plan price', () => {
    const trial = PLANS.find((plan) => plan.id === 'trial');
    const full = PLANS.find((plan) => plan.id === 'full');
    expect(trial?.trialDays).toBeNull();
    expect(trial?.headline).toBe('');
    expect(full?.priceUsdCents).toBeNull();
  });

  it('builds the public cards from the saved offer and the saved USD price', () => {
    const live = plansForPublic(
      [
        { code: 'us', currency: 'USD', amountMinor: 4500 },
        { code: 'pk', currency: 'PKR', amountMinor: 700000 },
      ],
      sampleOffer,
    );
    expect(live.find((plan) => plan.id === 'full')?.priceUsdCents).toBe(4500);
    expect(live.find((plan) => plan.id === 'trial')).toMatchObject({
      trialDays: 12,
      headline: '12-day free trial with every feature',
      limitations: 'Read-only after the trial ends.',
    });

    const missing = plansForPublic([{ code: 'pk', currency: 'PKR', amountMinor: 700000 }], sampleOffer);
    expect(missing.find((plan) => plan.id === 'full')?.priceUsdCents).toBeNull();

    const invalid = plansForPublic([{ code: 'us', currency: 'USD', amountMinor: 0 }], sampleOffer);
    expect(invalid.find((plan) => plan.id === 'full')?.priceUsdCents).toBeNull();
  });

  it('accepts a trial length from 1 to 90 days', () => {
    expect(parseTrialDays(1)).toBe(1);
    expect(parseTrialDays(90)).toBe(90);
    expect(() => parseTrialDays(0)).toThrow(ValidationError);
    expect(() => parseTrialDays(91)).toThrow(ValidationError);
  });

  it('does not rewrite existing trial end dates when saving the plan offer', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'migrations', '0027_plan_offer.sql'), 'utf8');
    expect(sql).not.toMatch(/UPDATE\s+organizations/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+organizations/i);
  });

  it('does not rewrite existing trial end dates in the new migration', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'migrations', '0023_regional_pricing_and_manual_payments.sql'),
      'utf8',
    );
    expect(sql).not.toMatch(/UPDATE\s+organizations/i);
    expect(sql).not.toMatch(/trial_ends_at\s*=/i);
    expect(sql).toMatch(/is_placeholder/);
    expect(sql).toMatch(/Payoneer — US bank transfer \(ACH\)/);
    expect(sql).toMatch(/\('jazzcash'/);
    expect(sql).not.toMatch(/IBAN|account number|routing/i);
  });
});

describe('regional amount parsing', () => {
  it('converts a major amount into minor units', () => {
    expect(majorToMinor('20')).toBe(2000);
    expect(majorToMinor('20.50')).toBe(2050);
    expect(majorToMinor('6000')).toBe(600000);
  });
});

describe('payment gateway plug', () => {
  it('keeps AssanPay addressable when the gateway switch is off', () => {
    const gateway = createPaymentGateway({ ...DEFAULT_PAYMENT_GATEWAY_CONFIG, enabled: false, provider: 'assanpay' });
    expect(gateway.key).toBe('assanpay');
    const mock = createPaymentGateway({ ...DEFAULT_PAYMENT_GATEWAY_CONFIG, provider: 'mock' });
    expect(mock.key).toBe('mock');
  });
});

describe('patient CSV import', () => {
  it('parses quoted commas and suggests the template columns', () => {
    const table = parseCsv(PATIENT_IMPORT_TEMPLATE + '"Rahman, Layla",+971501112233,layla@example.com,1990-04-12,"Morning, please"\n');
    expect(table[0]).toEqual(['name', 'phone', 'email', 'dob', 'notes']);
    expect(table[1]?.[0]).toBe('Rahman, Layla');
    expect(table[1]?.[4]).toBe('Morning, please');
  });

  it('previews ready rows, validation errors, and duplicates', () => {
    const csv = [
      'name,phone,email,dob,notes',
      'Layla Rahman,+971501112233,layla@example.com,1990-04-12,Morning',
      'Omar Nasser,971501112233,omar@example.com,1988-01-02,',
      'OnlyFirst,971509998877,only@example.com,1991-03-03,',
      'Sara Halim,not-a-phone,sara@example.com,1992-05-05,',
      'Huda Al Khalifa,+971501110000,layla@example.com,1985-06-06,Existing email',
    ].join('\n');
    const preview = classifyImportRows({
      csv,
      existingPhones: [],
      existingEmails: ['layla@example.com'],
    });
    expect(preview.rows.map((row) => row.status)).toEqual(['duplicate', 'duplicate', 'error', 'error', 'duplicate']);
    expect(preview.rows[0]?.messages.join(' ')).toMatch(/email already exists/);
    expect(preview.rows[1]?.messages.join(' ')).toMatch(/earlier in this file/);
    expect(preview.rows[2]?.messages.join(' ')).toMatch(/first and last name/);
    expect(preview.rows[3]?.messages.join(' ')).toMatch(/Phone/);
    expect(preview.readyCount).toBe(0);
  });

  it('marks a clean row ready and splits the name', () => {
    const csv = 'name,phone,email,dob,notes\nLayla Rahman,+971501112233,layla@example.com,1990-04-12,Morning\n';
    const preview = classifyImportRows({ csv, existingPhones: [], existingEmails: [] });
    expect(preview.readyCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      firstName: 'Layla',
      lastName: 'Rahman',
      phone: '971501112233',
      email: 'layla@example.com',
      dateOfBirth: '1990-04-12',
      notes: 'Morning',
      status: 'ready',
    });
  });
});
