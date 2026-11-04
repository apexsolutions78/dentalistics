import { describe, expect, it } from 'vitest';
import {
  assertPaymentAmount,
  assertPaymentMethod,
  bucketKey,
  deriveInvoiceStatus,
  enumerateBuckets,
  formatInvoiceNumber,
  invoiceTotals,
  lineTotals,
  parseInvoiceLines,
  paymentMethodsFor,
  toCsv,
} from '../src/billing/patientMoney';
import { ValidationError } from '../src/errors';

describe('patient invoice money', () => {
  it('computes quantity, discount, and tax in minor units', () => {
    const line = lineTotals({
      description: 'Cleaning',
      quantityHundredths: 200,
      unitPriceCents: 5000,
      discountCents: 1000,
      taxPercentHundredths: 500,
    });
    expect(line).toEqual({
      grossCents: 10000,
      discountCents: 1000,
      netCents: 9000,
      taxCents: 450,
      totalCents: 9450,
    });
    expect(invoiceTotals([line]).totalCents).toBe(9450);
  });

  it('rounds half up on a fractional quantity', () => {
    const line = lineTotals({
      description: 'X-ray',
      quantityHundredths: 150,
      unitPriceCents: 1,
      discountCents: 0,
      taxPercentHundredths: 0,
    });
    expect(line.grossCents).toBe(2);
  });

  it('rejects a discount larger than the line', () => {
    expect(() =>
      lineTotals({
        description: 'Filling',
        quantityHundredths: 100,
        unitPriceCents: 1000,
        discountCents: 1001,
        taxPercentHundredths: 0,
      }),
    ).toThrow(ValidationError);
  });

  it('parses a line list and keeps two decimal places', () => {
    const lines = parseInvoiceLines([
      { description: 'Scale and polish', quantity: 1, unitPriceCents: 15000, taxPercent: 5 },
    ]);
    expect(lines[0]).toMatchObject({
      quantityHundredths: 100,
      unitPriceCents: 15000,
      discountCents: 0,
      taxPercentHundredths: 500,
    });
  });

  it('moves an issued invoice through partial payment, paid, and a refund', () => {
    expect(deriveInvoiceStatus('issued', 9450, 0)).toBe('issued');
    expect(deriveInvoiceStatus('issued', 9450, 4000)).toBe('partially_paid');
    expect(deriveInvoiceStatus('partially_paid', 9450, 9450)).toBe('paid');
    expect(deriveInvoiceStatus('paid', 9450, 4000)).toBe('partially_paid');
    expect(deriveInvoiceStatus('issued', 0, 0)).toBe('paid');
    expect(deriveInvoiceStatus('draft', 9450, 0)).toBe('draft');
    expect(deriveInvoiceStatus('void', 9450, 0)).toBe('void');
  });

  it('treats a refund as a negative payment that cannot exceed what was collected', () => {
    const issues = (fn: () => void): string => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        return (err as ValidationError).issues.join(' ');
      }
      throw new Error('expected a validation error');
    };
    expect(
      issues(() => assertPaymentAmount({ amountCents: -100, paidCents: 50, balanceCents: 0, status: 'paid' })),
    ).toMatch(/refund cannot exceed/);
    expect(
      issues(() => assertPaymentAmount({ amountCents: 10, paidCents: 0, balanceCents: 0, status: 'draft' })),
    ).toMatch(/Issue the invoice/);
    expect(
      issues(() => assertPaymentAmount({ amountCents: 500, paidCents: 0, balanceCents: 100, status: 'issued' })),
    ).toMatch(/cannot exceed the balance/);
  });

  it('offers JazzCash and EasyPaisa only for PKR', () => {
    expect(paymentMethodsFor('AED')).not.toContain('jazzcash');
    expect(paymentMethodsFor('PKR')).toEqual(
      expect.arrayContaining(['cash', 'jazzcash', 'easypaisa']),
    );
    expect(assertPaymentMethod('PKR', 'easypaisa')).toBe('easypaisa');
    expect(() => assertPaymentMethod('USD', 'jazzcash')).toThrow(ValidationError);
    try {
      assertPaymentMethod('USD', 'jazzcash');
    } catch (err) {
      expect((err as ValidationError).issues.join(' ')).toMatch(/PKR/);
    }
  });

  it('numbers invoices per sequence and groups report days into weeks and months', () => {
    expect(formatInvoiceNumber('INV', 1)).toBe('INV-0001');
    expect(formatInvoiceNumber('INV', 10000)).toBe('INV-10000');
    expect(bucketKey('2026-11-08', 'week')).toBe('2026-11-02');
    expect(bucketKey('2026-11-08', 'month')).toBe('2026-11-01');
    expect(enumerateBuckets('2026-11-30', '2026-12-02', 'month')).toEqual(['2026-11-01', '2026-12-01']);
  });

  it('quotes csv cells that contain commas', () => {
    expect(toCsv([['a,b', 1, null]])).toBe('"a,b",1,\r\n');
  });
});
