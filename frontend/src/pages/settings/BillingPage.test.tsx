import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { BillingPage } from './BillingPage';
import { jsonResponse, makeUser } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = (url: string, init?: RequestInit) => Response | null;

function stub(handler: Handler): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(jsonResponse(200, { user: makeUser() }));
    }
    const res = handler(url, init);
    return Promise.resolve(
      res ?? jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage(ui: ReactElement): void {
  render(
    <MemoryRouter initialEntries={['/settings/billing']}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

function makeSummary(
  overrides: Partial<{
    plan: 'trial' | 'full';
    gatewayEnabled: boolean;
    reasons: string[];
    payments: Array<Record<string, unknown>>;
  }> = {},
) {
  const plan = overrides.plan ?? 'trial';
  return {
    organization: {
      id: 1,
      name: 'Test Clinic',
      plan,
      trialEndsAt: plan === 'trial' ? '2099-01-01T00:00:00.000Z' : null,
    },
    price: { amountUsdCents: 2000, currency: 'USD', interval: 'month', name: 'Full Plan' },
    gateway: {
      enabled: overrides.gatewayEnabled ?? false,
      provider: 'assanpay',
      configured: overrides.gatewayEnabled ?? false,
      reasons: overrides.reasons ?? ['Gateway is switched off'],
    },
    payments: overrides.payments ?? [],
  };
}

const pendingPayment = {
  orderId: 'abc1',
  status: 'pending',
  amountUsdCents: 2000,
  currency: 'USD',
  provider: 'mock',
  checkoutUrl: null,
  lastError: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  paidAt: null,
};

describe('BillingPage', () => {
  it('shows the plan price and keeps checkout disabled while the gateway is off', async () => {
    stub((url) => (url.includes('/billing') ? jsonResponse(200, makeSummary()) : null));
    renderPage(<BillingPage />);
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(await screen.findByText(/— \$20\.00 USD per month/)).toBeInTheDocument();
    expect(screen.getByText('Online payment unavailable')).toBeInTheDocument();
    expect(screen.getByText('Gateway is switched off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade — $20.00/month' })).toBeDisabled();
  });

  it('starts checkout and follows the gateway link when payments are enabled', async () => {
    const fn = stub((url, init) => {
      if (url.includes('/billing/checkout') && init?.method === 'POST') {
        return jsonResponse(201, {
          payment: {
            orderId: 'abc1',
            checkoutUrl: '/billing/mock/abc1',
            amountUsdCents: 2000,
            currency: 'USD',
            provider: 'mock',
            status: 'pending',
          },
        });
      }
      if (url.includes('/billing')) {
        return jsonResponse(200, makeSummary({ gatewayEnabled: true, reasons: [] }));
      }
      return null;
    });
    renderPage(<BillingPage />);
    const upgrade = await screen.findByRole('button', { name: 'Upgrade — $20.00/month' });
    expect(upgrade).toBeEnabled();
    expect(screen.getByText('Online payment available')).toBeInTheDocument();

    fireEvent.click(upgrade);
    await waitFor(() => {
      expect(
        fn.mock.calls.some(
          ([input, init]) =>
            String(input).includes('/billing/checkout') && init?.method === 'POST',
        ),
      ).toBe(true);
    });
  });

  it('shows a checkout error from the API', async () => {
    stub((url, init) => {
      if (url.includes('/billing/checkout') && init?.method === 'POST') {
        return jsonResponse(409, {
          error: { code: 'gateway_disabled', message: 'Online payments are switched off.' },
        });
      }
      if (url.includes('/billing')) {
        return jsonResponse(200, makeSummary({ gatewayEnabled: true, reasons: [] }));
      }
      return null;
    });
    renderPage(<BillingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade — $20.00/month' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Online payments are switched off.',
    );
  });

  it('lists pending payments and reports a still-pending status check', async () => {
    stub((url) => {
      if (url.includes('/billing/payments/abc1/status')) {
        return jsonResponse(200, {
          orderId: 'abc1',
          status: 'pending',
          plan: 'trial',
          payment: pendingPayment,
        });
      }
      if (url.includes('/billing')) {
        return jsonResponse(200, makeSummary({ payments: [pendingPayment] }));
      }
      return null;
    });
    renderPage(<BillingPage />);
    expect(await screen.findByText('abc1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    expect(await screen.findByText(/Payment still pending/)).toBeInTheDocument();
  });

  it('shows the Full Plan state without an upgrade button', async () => {
    stub((url) =>
      url.includes('/billing')
        ? jsonResponse(
            200,
            makeSummary({ plan: 'full', gatewayEnabled: true, reasons: [] }),
          )
        : null,
    );
    renderPage(<BillingPage />);
    expect(
      await screen.findByText('This clinic is already on the Full Plan.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Online payment available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).toBeNull();
  });
});
