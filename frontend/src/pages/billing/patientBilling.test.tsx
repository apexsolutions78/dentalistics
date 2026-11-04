import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AppRouter } from '../../app/router';
import { formatMoney, majorToCents, paymentMethodsFor } from '../../lib/patientBilling';
import { jsonResponse, makeOrganization, makeUser } from '../../test/fixtures';
import type { InvoiceDetail } from '../../lib/patientBilling';

afterEach(() => {
  vi.unstubAllGlobals();
});

function emptyInvoices() {
  return {
    invoices: [],
    total: 0,
    limit: 20,
    offset: 0,
    balance: null,
  };
}

function settings() {
  return {
    settings: {
      currency: 'AED',
      taxLabel: 'VAT',
      invoicePrefix: 'INV',
      nextNumber: 1,
      paymentMethods: ['cash', 'card_terminal', 'bank_transfer', 'other'],
    },
  };
}

const invoice: InvoiceDetail = {
  id: 9,
  patientId: 3,
  patientName: 'Layla Rahman',
  number: 'INV-0001',
  status: 'issued',
  currency: 'AED',
  taxLabel: 'VAT',
  totalCents: 10500,
  paidCents: 0,
  balanceCents: 10500,
  issuedAt: '2026-11-04T09:00:00.000Z',
  createdAt: '2026-11-04T09:00:00.000Z',
  updatedAt: '2026-11-04T09:00:00.000Z',
  notes: 'Hygiene visit',
  subtotalCents: 10000,
  discountCents: 0,
  taxCents: 500,
  voidedAt: null,
  voidReason: null,
  patient: {
    id: 3,
    firstName: 'Layla',
    lastName: 'Rahman',
    phone: '+971500000111',
    email: 'layla@example.com',
  },
  lines: [
    {
      id: 1,
      position: 1,
      description: 'Scale and polish',
      quantity: '1.00',
      unitPriceCents: 10000,
      discountCents: 0,
      taxPercent: '5.00',
      subtotalCents: 10000,
      taxCents: 500,
      totalCents: 10500,
    },
  ],
  payments: [],
  letterhead: {
    name: 'Marina Dental',
    phone: '+9714000000',
    email: 'desk@clinic.test',
    address: '12 Marina Walk',
    logoUrl: null,
  },
};

function renderAt(path: string, role: 'owner' | 'receptionist' = 'owner'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, {
          user: makeUser({ role, email: role === 'owner' ? 'owner@example.com' : 'desk@example.com' }),
          organization: makeOrganization(),
        }),
      );
    }
    if (url.includes('/patient-billing/invoices/9')) {
      return Promise.resolve(jsonResponse(200, { invoice }));
    }
    if (url.includes('/patient-billing/reports')) {
      return Promise.resolve(
        jsonResponse(200, {
          window: { from: '2026-11-01', to: '2026-11-30', groupBy: 'day' },
          currency: 'AED',
          basis: 'test',
          summary: {
            revenueCents: 0,
            paymentsCollectedCents: 0,
            refundsCents: 0,
            netCollectedCents: 0,
            outstandingCents: 0,
            expensesCents: 0,
            profitCents: 0,
            appointments: 0,
            noShows: 0,
            noShowRate: null,
            appointmentCounts: {},
          },
          buckets: [],
          excluded: [],
          definitions: { basis: 'test' },
        }),
      );
    }
    if (url.includes('/patient-billing/expenses')) {
      return Promise.resolve(jsonResponse(200, { expenses: [], total: 0, limit: 20, offset: 0 }));
    }
    if (url.includes('/patient-billing/settings')) {
      return Promise.resolve(jsonResponse(200, settings()));
    }
    if (url.includes('/patient-billing/invoices')) {
      return Promise.resolve(jsonResponse(200, emptyInvoices()));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('patient billing screens', () => {
  it('formats money and keeps Pakistan wallet methods on PKR', () => {
    expect(formatMoney(10500, 'AED')).toBe('AED 105.00');
    expect(formatMoney(-1500, 'PKR')).toBe('-PKR 15.00');
    expect(majorToCents('10.5')).toBe(1050);
    expect(paymentMethodsFor('AED')).not.toContain('jazzcash');
    expect(paymentMethodsFor('PKR')).toContain('easypaisa');
  });

  it('shows a sample on an empty invoice list and does not save it', async () => {
    const fetchMock = renderAt('/patient-billing');
    expect(await screen.findByRole('heading', { name: 'Patient billing' })).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Peek at an example' }));
    expect(screen.getByText(/INV-0142 for Layla Rahman/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('hides the sample when a search matches nothing', async () => {
    renderAt('/patient-billing?q=missing');
    expect(await screen.findByText('No invoices match this search.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Peek at an example' })).not.toBeInTheDocument();
  });

  it('prints a letterhead invoice and offers a refund as well as a payment', async () => {
    renderAt('/patient-billing/invoices/9');
    expect(await screen.findByRole('heading', { name: 'Marina Dental' })).toBeInTheDocument();
    expect(screen.getByText('12 Marina Walk')).toBeInTheDocument();
    expect(screen.getByText('Scale and polish')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Refund' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Peek at an example' }));
    expect(screen.getByText(/card terminal, AED 150.00/)).toBeInTheDocument();
  });

  it('lets an owner open an empty expenses list and an empty report', async () => {
    renderAt('/patient-billing/expenses');
    expect(await screen.findByRole('heading', { name: 'Expenses' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Peek at an example' }));
    expect(screen.getByText(/gloves and masks/)).toBeInTheDocument();
  });

  it('shows the report sample and a CSV download when the period is empty', async () => {
    renderAt('/patient-billing/reports');
    expect(await screen.findByRole('heading', { name: 'Billing reports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      expect.stringContaining('/patient-billing/reports.csv'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Peek at an example' }));
    expect(screen.getByText(/no-show rate 10%/)).toBeInTheDocument();
  });

  it('keeps a receptionist on the invoice list', async () => {
    renderAt('/patient-billing', 'receptionist');
    expect(await screen.findByRole('heading', { name: 'Patient billing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('denies a receptionist the reports page', async () => {
    renderAt('/patient-billing/reports', 'receptionist');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
});
