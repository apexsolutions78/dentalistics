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

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card_terminal: 'Card terminal',
  bank_transfer: 'Bank transfer',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  other: 'Other',
};

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  void: 'Void',
};

export function paymentMethodsFor(currency: string): PaymentMethod[] {
  if (currency === 'PKR') return [...PAYMENT_METHODS];
  return PAYMENT_METHODS.filter((method) => method !== 'jazzcash' && method !== 'easypaisa');
}

export function formatMoney(cents: number, currency: string): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${currency} ${grouped}.${frac}`;
}

export function majorToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

export interface BillingSettings {
  currency: PatientCurrency;
  taxLabel: TaxLabel;
  invoicePrefix: string;
  nextNumber: number;
  paymentMethods: PaymentMethod[];
}

export interface PatientBalance {
  patientId: number;
  currency: string;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface InvoiceSummary {
  id: number;
  patientId: number;
  patientName: string;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  taxLabel: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  id: number;
  position: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountCents: number;
  taxPercent: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface PatientPayment {
  id: number;
  invoiceId: number;
  invoiceNumber: string | null;
  patientId: number;
  patientName: string;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  note: string | null;
  createdAt: string;
}

export interface InvoiceLetterhead {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logoUrl: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  notes: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  voidedAt: string | null;
  voidReason: string | null;
  patient: {
    id: number;
    firstName: string;
    lastName: string;
    phone: string;
    email: string | null;
  };
  lines: InvoiceLine[];
  payments: PatientPayment[];
  letterhead: InvoiceLetterhead;
}

export interface ClinicExpense {
  id: number;
  category: string;
  amountCents: number;
  currency: string;
  expenseDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportBucket {
  start: string;
  revenueCents: number;
  paymentsCollectedCents: number;
  refundsCents: number;
  netCollectedCents: number;
  outstandingCents: number;
  expensesCents: number;
  profitCents: number;
  appointments: number;
  noShows: number;
  noShowRate: number | null;
  appointmentCounts: Record<string, number>;
}

export interface PatientBillingReport {
  window: { from: string; to: string; groupBy: 'day' | 'week' | 'month' };
  currency: string;
  basis: string;
  summary: {
    revenueCents: number;
    paymentsCollectedCents: number;
    refundsCents: number;
    netCollectedCents: number;
    outstandingCents: number;
    expensesCents: number;
    profitCents: number;
    appointments: number;
    noShows: number;
    noShowRate: number | null;
    appointmentCounts: Record<string, number>;
  };
  buckets: ReportBucket[];
  excluded: Array<{
    currency: string;
    revenueCents: number;
    paymentsCollectedCents: number;
    refundsCents: number;
    expensesCents: number;
  }>;
  definitions: { basis: string };
}
