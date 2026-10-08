import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { MockCheckoutPage } from './MockCheckoutPage';
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

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/billing/mock/:orderId" element={<MockCheckoutPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const statusResult = {
  orderId: 'abc123',
  status: 'paid',
  plan: 'full',
  payment: {
    orderId: 'abc123',
    status: 'paid',
    amountUsdCents: 2000,
    currency: 'USD',
    provider: 'mock',
    checkoutUrl: null,
    lastError: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    paidAt: '2026-10-01T09:05:00.000Z',
  },
};

describe('MockCheckoutPage', () => {
  it('records a simulated successful payment', async () => {
    const fn = stub((url, init) =>
      url.includes('/mock-complete') && init?.method === 'POST'
        ? jsonResponse(200, statusResult)
        : null,
    );
    renderAt('/billing/mock/abc123');
    expect(await screen.findByRole('heading', { name: 'Order abc123' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }));
    expect(await screen.findByText('Mock payment recorded as paid.')).toBeInTheDocument();
    expect(
      fn.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/billing/payments/abc123/mock-complete') &&
          init?.method === 'POST' &&
          String((init.body as string | undefined) ?? '').includes('"paid"'),
      ),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Simulate successful payment' }),
    ).toBeDisabled();
  });

  it('records a simulated failed payment', async () => {
    stub((url, init) =>
      url.includes('/mock-complete') && init?.method === 'POST'
        ? jsonResponse(200, { ...statusResult, status: 'failed', plan: 'trial' })
        : null,
    );
    renderAt('/billing/mock/abc123');
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate failed payment' }));
    expect(await screen.findByText('Mock payment recorded as failed.')).toBeInTheDocument();
  });

  it('shows an API error from the mock completion endpoint', async () => {
    stub((url, init) =>
      url.includes('/mock-complete') && init?.method === 'POST'
        ? jsonResponse(409, {
            error: { code: 'mock_disabled', message: 'Mock payments are disabled.' },
          })
        : null,
    );
    renderAt('/billing/mock/abc123');
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate successful payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mock payments are disabled.');
  });

  it('rejects an invalid order id', async () => {
    stub(() => null);
    renderAt('/billing/mock/not%20valid');
    expect(await screen.findByText('This mock checkout link is not valid.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simulate successful payment' })).toBeNull();
  });
});
