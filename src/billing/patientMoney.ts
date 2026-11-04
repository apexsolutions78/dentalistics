import { ValidationError } from '../errors';

/**
 * Clinic-side patient billing arithmetic.
 * Amounts are integer minor units (cents, fils, pence, paisa). Every
 * currency in PATIENT_CURRENCIES has a 2-decimal minor unit.
 */

export const PATIENT_CURRENCIES = ['AED', 'USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'PKR'] as const;
export type PatientCurrency = (typeof PATIENT_CURRENCIES)[number];

export const TAX_LABELS = ['VAT', 'GST', 'HST', 'Sales tax'] as const;
export type TaxLabel = (typeof TAX_LABELS)[number];

export const PAYMENT_METHODS = [
  'cash',
  'card_terminal',
  'bank_transfer',
  'jazzcash',
  'easypaisa',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PK_PAYMENT_METHODS = ['jazzcash', 'easypaisa'] as const;

export const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const REPORT_GROUPS = ['day', 'week', 'month'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const APPOINTMENT_COUNT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'COMPLETED',
  'NO_SHOW',
  'CANCELLED',
  'RESCHEDULED',
] as const;
export type AppointmentCountStatus = (typeof APPOINTMENT_COUNT_STATUSES)[number];

/** Statuses that were expected to be attended. Cancelled and rescheduled rows are excluded. */
export const NO_SHOW_DENOMINATOR = ['SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW'] as const;

export const MAX_INVOICE_LINES = 40;
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
export const MAX_REPORT_DAYS = 366;
export const MAX_INVOICE_SEQUENCE = 9_999_999;

const DEFAULT_CURRENCY: PatientCurrency = 'AED';
const DEFAULT_TAX_LABEL: TaxLabel = 'VAT';
const DEFAULT_PREFIX = 'INV';

export interface LineInput {
  description: string;
  quantityHundredths: number;
  unitPriceCents: number;
  discountCents: number;
  taxPercentHundredths: number;
}

export interface LineTotals {
  grossCents: number;
  discountCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface AppointmentCounts {
  SCHEDULED: number;
  CONFIRMED: number;
  COMPLETED: number;
  NO_SHOW: number;
  CANCELLED: number;
  RESCHEDULED: number;
  counted: number;
  noShows: number;
  noShowRate: number | null;
}

export function emptyAppointmentCounts(): AppointmentCounts {
  return {
    SCHEDULED: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    NO_SHOW: 0,
    CANCELLED: 0,
    RESCHEDULED: 0,
    counted: 0,
    noShows: 0,
    noShowRate: null,
  };
}

function halfUpDiv(numerator: number, denominator: number): number {
  if (numerator < 0) {
    return -halfUpDiv(-numerator, denominator);
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function lineTotals(line: LineInput): LineTotals {
  const grossCents = halfUpDiv(line.quantityHundredths * line.unitPriceCents, 100);
  if (line.discountCents > grossCents) {
    throw new ValidationError('Invalid input', ['discount cannot exceed the line amount']);
  }
  const netCents = grossCents - line.discountCents;
  const taxCents = halfUpDiv(netCents * line.taxPercentHundredths, 10_000);
  return {
    grossCents,
    discountCents: line.discountCents,
    netCents,
    taxCents,
    totalCents: netCents + taxCents,
  };
}

export function invoiceTotals(lines: readonly LineTotals[]): InvoiceTotals {
  return lines.reduce<InvoiceTotals>(
    (sum, line) => ({
      subtotalCents: sum.subtotalCents + line.grossCents,
      discountCents: sum.discountCents + line.discountCents,
      taxCents: sum.taxCents + line.taxCents,
      totalCents: sum.totalCents + line.totalCents,
    }),
    { subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 0 },
  );
}

export function deriveInvoiceStatus(
  stored: InvoiceStatus,
  totalCents: number,
  paidCents: number,
): InvoiceStatus {
  if (stored === 'draft' || stored === 'void') {
    return stored;
  }
  if (paidCents <= 0) {
    return totalCents === 0 ? 'paid' : 'issued';
  }
  if (paidCents >= totalCents) {
    return 'paid';
  }
  return 'partially_paid';
}

export function formatInvoiceNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export function paymentMethodsFor(currency: string): readonly PaymentMethod[] {
  if (currency === 'PKR') {
    return PAYMENT_METHODS;
  }
  return PAYMENT_METHODS.filter((method) => method !== 'jazzcash' && method !== 'easypaisa');
}

export function assertPaymentMethod(currency: string, method: string): PaymentMethod {
  const allowed = paymentMethodsFor(currency);
  if (!allowed.includes(method as PaymentMethod)) {
    throw new ValidationError('Invalid input', [
      method === 'jazzcash' || method === 'easypaisa'
        ? `${method} is available when the clinic currency is PKR`
        : `method must be one of: ${allowed.join(', ')}`,
    ]);
  }
  return method as PaymentMethod;
}

export function assertPaymentAmount(input: {
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  status: InvoiceStatus;
}): void {
  if (input.status === 'draft' || input.status === 'void') {
    throw new ValidationError('Invalid input', [
      input.status === 'draft'
        ? 'Issue the invoice before recording a payment'
        : 'A void invoice cannot take a payment',
    ]);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) {
    throw new ValidationError('Invalid input', ['amountCents must be a non-zero integer']);
  }
  if (input.amountCents > 0 && input.amountCents > input.balanceCents) {
    throw new ValidationError('Invalid input', ['payment cannot exceed the balance due']);
  }
  if (input.amountCents < 0 && -input.amountCents > input.paidCents) {
    throw new ValidationError('Invalid input', ['refund cannot exceed the amount already paid']);
  }
}

export function quantityToString(quantityHundredths: number): string {
  const sign = quantityHundredths < 0 ? '-' : '';
  const abs = Math.abs(quantityHundredths);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}

export function taxPercentToString(taxPercentHundredths: number): string {
  return quantityToString(taxPercentHundredths);
}

function parseScaled(value: unknown, name: string, scale: number, max: number): number {
  let text: string;
  if (typeof value === 'number' && Number.isFinite(value)) {
    text = value.toFixed(scale);
    const rounded = Number(text);
    if (Math.abs(value - rounded) > 10 ** -(scale + 2)) {
      throw new ValidationError('Invalid input', [`${name} must have at most ${scale} decimal places`]);
    }
  } else if (typeof value === 'string' && new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value.trim())) {
    text = value.trim();
  } else {
    throw new ValidationError('Invalid input', [`${name} must be a positive number`]);
  }
  const [whole, frac = ''] = text.split('.');
  const scaled = Number(whole) * 10 ** scale + Number(frac.padEnd(scale, '0'));
  if (!Number.isSafeInteger(scaled) || scaled <= 0 || scaled > max) {
    throw new ValidationError('Invalid input', [`${name} must be greater than 0 and at most ${max / 10 ** scale}`]);
  }
  return scaled;
}

export function parseQuantityHundredths(value: unknown): number {
  return parseScaled(value, 'quantity', 2, 999_999);
}

export function parseTaxPercentHundredths(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  if (value === 0 || value === '0' || value === '0.0' || value === '0.00') {
    return 0;
  }
  return parseScaled(value, 'taxPercent', 2, 10_000);
}

export function parseCents(value: unknown, name: string, options: { allowZero?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('Invalid input', [`${name} must be an integer number of minor units`]);
  }
  const min = options.allowZero === false ? 1 : 0;
  if (value < min || value > MAX_UNIT_PRICE_CENTS) {
    throw new ValidationError('Invalid input', [
      `${name} must be between ${min} and ${MAX_UNIT_PRICE_CENTS}`,
    ]);
  }
  return value;
}

export function parseSignedCents(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value === 0) {
    throw new ValidationError('Invalid input', [`${name} must be a non-zero integer`]);
  }
  if (Math.abs(value) > MAX_UNIT_PRICE_CENTS) {
    throw new ValidationError('Invalid input', [`${name} is too large`]);
  }
  return value;
}

export function parseCurrency(value: unknown): PatientCurrency {
  if (typeof value !== 'string' || !PATIENT_CURRENCIES.includes(value as PatientCurrency)) {
    throw new ValidationError('Invalid input', [
      `currency must be one of: ${PATIENT_CURRENCIES.join(', ')}`,
    ]);
  }
  return value as PatientCurrency;
}

export function parseTaxLabel(value: unknown): TaxLabel {
  if (typeof value !== 'string' || !TAX_LABELS.includes(value as TaxLabel)) {
    throw new ValidationError('Invalid input', [`taxLabel must be one of: ${TAX_LABELS.join(', ')}`]);
  }
  return value as TaxLabel;
}

const PREFIX_PATTERN = /^[A-Z0-9]{1,8}$/;

export function parseInvoicePrefix(value: unknown): string {
  if (typeof value !== 'string' || !PREFIX_PATTERN.test(value)) {
    throw new ValidationError('Invalid input', [
      'invoicePrefix must be 1-8 letters or digits (A-Z, 0-9)',
    ]);
  }
  return value;
}

export function parseInvoiceLines(value: unknown): LineInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INVOICE_LINES) {
    throw new ValidationError('Invalid input', [
      `lines must contain between 1 and ${MAX_INVOICE_LINES} items`,
    ]);
  }
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ValidationError('Invalid input', [`lines[${index}] must be an object`]);
    }
    const line = raw as Record<string, unknown>;
    const description = typeof line.description === 'string' ? line.description.trim() : '';
    if (description.length < 1 || description.length > 200) {
      throw new ValidationError('Invalid input', [
        `lines[${index}].description must be between 1 and 200 characters`,
      ]);
    }
    const quantityHundredths = parseQuantityHundredths(line.quantity);
    const unitPriceCents = parseCents(line.unitPriceCents, `lines[${index}].unitPriceCents`, {
      allowZero: true,
    });
    const discountCents =
      line.discountCents === undefined
        ? 0
        : parseCents(line.discountCents, `lines[${index}].discountCents`, { allowZero: true });
    const taxPercentHundredths =
      line.taxPercent === undefined ? 0 : parseTaxPercentHundredths(line.taxPercent);
    const totals = lineTotals({
      description,
      quantityHundredths,
      unitPriceCents,
      discountCents,
      taxPercentHundredths,
    });
    return {
      description,
      quantityHundredths,
      unitPriceCents,
      discountCents: totals.discountCents,
      taxPercentHundredths,
    };
  });
}

export function defaultBillingSettings(): {
  currency: PatientCurrency;
  taxLabel: TaxLabel;
  invoicePrefix: string;
  nextNumber: number;
} {
  return {
    currency: DEFAULT_CURRENCY,
    taxLabel: DEFAULT_TAX_LABEL,
    invoicePrefix: DEFAULT_PREFIX,
    nextNumber: 1,
  };
}

export function bucketKey(date: string, groupBy: ReportGroup): string {
  if (groupBy === 'day') {
    return date;
  }
  if (groupBy === 'month') {
    return `${date.slice(0, 7)}-01`;
  }
  const utc = new Date(`${date}T00:00:00Z`);
  const weekday = utc.getUTCDay();
  const delta = weekday === 0 ? 6 : weekday - 1;
  utc.setUTCDate(utc.getUTCDate() - delta);
  return utc.toISOString().slice(0, 10);
}

export function enumerateBuckets(from: string, to: string, groupBy: ReportGroup): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${bucketKey(from, groupBy)}T00:00:00Z`);
  const last = bucketKey(to, groupBy);
  while (keys.length <= MAX_REPORT_DAYS) {
    const key = cursor.toISOString().slice(0, 10);
    keys.push(key);
    if (key >= last) {
      return keys;
    }
    if (groupBy === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + (groupBy === 'week' ? 7 : 1));
    }
  }
  return keys;
}

export function assertReportWindow(from: string, to: string): void {
  if (from > to) {
    throw new ValidationError('Invalid input', ['from must be on or before to']);
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > MAX_REPORT_DAYS) {
    throw new ValidationError('Invalid input', [`date range must be ${MAX_REPORT_DAYS} days or fewer`]);
  }
}

export function noShowRate(noShows: number, counted: number): number | null {
  if (counted === 0) {
    return null;
  }
  return Math.round((noShows / counted) * 10_000) / 10_000;
}

export function addAppointmentStatus(counts: AppointmentCounts, status: string, n: number): void {
  if (
    status === 'SCHEDULED' ||
    status === 'CONFIRMED' ||
    status === 'COMPLETED' ||
    status === 'NO_SHOW' ||
    status === 'CANCELLED' ||
    status === 'RESCHEDULED'
  ) {
    counts[status] += n;
  }
  if (
    status === 'SCHEDULED' ||
    status === 'CONFIRMED' ||
    status === 'COMPLETED' ||
    status === 'NO_SHOW'
  ) {
    counts.counted += n;
  }
  if (status === 'NO_SHOW') {
    counts.noShows += n;
  }
  counts.noShowRate = noShowRate(counts.noShows, counts.counted);
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows: ReadonlyArray<readonly (string | number | null)[]>): string {
  return rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n') + '\r\n';
}

export const REPORT_BASIS =
  'Figures use the clinic currency currently saved in patient-billing settings. Invoices, payments, and expenses stored in another currency are listed under excluded and are not added in. ' +
  'Revenue is the total of invoices issued in the bucket (issued_at as a UTC date), excluding drafts and voids. ' +
  'Payments collected are positive patient payments whose paid_on falls in the bucket; refunds are the absolute value of negative payments. ' +
  'Net collected is payments minus refunds. ' +
  'Bucket outstanding is the remaining balance of invoices issued in that bucket, measured now. ' +
  'Summary outstanding is the remaining balance of every open invoice in the report currency, including those issued outside the window. ' +
  'Expenses use expense_date. Profit is revenue minus expenses. ' +
  'Appointment counts use appointment_date and are not currency-specific. The no-show rate is NO_SHOW divided by SCHEDULED + CONFIRMED + COMPLETED + NO_SHOW; cancelled and rescheduled rows are excluded. The rate is null when that denominator is 0, and otherwise rounded to 4 decimal places.';

export const REPORT_CSV_HEADER = [
  'bucket',
  'revenue_cents',
  'payments_collected_cents',
  'refunds_cents',
  'net_collected_cents',
  'outstanding_cents',
  'expenses_cents',
  'profit_cents',
  'scheduled',
  'confirmed',
  'completed',
  'no_shows',
  'cancelled',
  'rescheduled',
  'no_show_rate',
] as const;
