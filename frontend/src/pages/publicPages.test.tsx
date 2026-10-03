import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { MarketingPage } from './MarketingPage';
import { SignupPage } from './SignupPage';
import { makeOrganization, makePlans, jsonResponse } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MarketingPage', () => {
  it('loads and renders both public plans with owner-defined pricing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/public/plans')) {
          return Promise.resolve(jsonResponse(200, { plans: makePlans() }));
        }
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
        );
      }),
    );
    render(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Free Plan')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('8-day free trial with every feature')).toBeInTheDocument();
    expect(
      screen.getByText('Full access to every feature, $20 per month'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Full Plan')).toBeInTheDocument();
    expect(screen.getByText('$20')).toBeInTheDocument();
    expect(screen.getByText('/month')).toBeInTheDocument();
    const signInLinks = screen.getAllByRole('link', { name: 'Sign in' });
    expect(signInLinks.length).toBeGreaterThan(0);
    for (const link of signInLinks) {
      expect(link).toHaveAttribute('href', '/login');
    }
    expect(screen.getAllByRole('link', { name: /Start free trial/i }).length).toBeGreaterThan(0);
  });

  it('lists the planned product features', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/public/plans')) {
          return Promise.resolve(jsonResponse(200, { plans: makePlans() }));
        }
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
        );
      }),
    );
    render(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Everything your clinic needs' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lead capture')).toBeInTheDocument();
    expect(screen.getByText('Missed-call recovery')).toBeInTheDocument();
    expect(screen.getByText('Recall automation')).toBeInTheDocument();
    expect(screen.getByText('Review requests')).toBeInTheDocument();
    expect(screen.getByText('Owner dashboard')).toBeInTheDocument();
    expect(screen.getByText('Templates and settings')).toBeInTheDocument();
  });

  it('shows a fallback when pricing cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(500, { error: { code: 'internal_error', message: 'Server error' } }),
        ),
      ),
    );
    render(
      <MemoryRouter>
        <MarketingPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Pricing is unavailable right now. Please try again later.')).toBeInTheDocument();
  });
});

describe('SignupPage', () => {
  function renderSignup() {
    return render(
      <MemoryRouter initialEntries={['/signup']}>
        <AuthProvider>
          <Routes>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/onboarding" element={<div>ONBOARDING_PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
  }

  it('validates all three fields locally without calling the API', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderSignup();

    fireEvent.click(await screen.findByRole('button', { name: 'Start free trial' }));
    expect(await screen.findByText('Enter your clinic name (at least 2 characters).')).toBeInTheDocument();
    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password must be between 12 and 200 characters.')).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL]>;
    expect(calls.some((c) => String(c[0]).includes('/api/auth/signup'))).toBe(false);
  });

  it('creates the account and continues to the onboarding wizard', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
        );
      }
      if (url.includes('/api/auth/signup')) {
        return Promise.resolve(
          jsonResponse(201, {
            user: { id: 9, email: 'owner@newclinic.test', role: 'owner', organizationId: 9 },
            organization: makeOrganization({
              id: 9,
              name: 'New Clinic',
              plan: 'trial',
              onboardingCompletedAt: null,
            }),
          }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderSignup();

    fireEvent.change(await screen.findByLabelText(/Clinic name/), {
      target: { value: 'New Clinic' },
    });
    fireEvent.change(screen.getByLabelText(/Your email/), {
      target: { value: 'owner@newclinic.test' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'LongEnoughPassw0rd!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start free trial' }));

    expect(await screen.findByText('ONBOARDING_PAGE')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/auth/signup'));
    expect(call).toBeDefined();
    const init = (call as unknown as [RequestInfo | URL, RequestInit?])[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(
      JSON.stringify({
        clinicName: 'New Clinic',
        email: 'owner@newclinic.test',
        password: 'LongEnoughPassw0rd!',
      }),
    );
  });

  it('surfaces the duplicate-email error from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
          );
        }
        if (url.includes('/api/auth/signup')) {
          return Promise.resolve(
            jsonResponse(409, {
              error: { code: 'email_taken', message: 'An account with this email already exists' },
            }),
          );
        }
        return Promise.resolve(
          jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
        );
      }),
    );
    renderSignup();

    fireEvent.change(await screen.findByLabelText(/Clinic name/), {
      target: { value: 'Dupe Clinic' },
    });
    fireEvent.change(screen.getByLabelText(/Your email/), {
      target: { value: 'owner@newclinic.test' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: 'LongEnoughPassw0rd!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start free trial' }));
    expect(
      await screen.findByText('An account with this email already exists'),
    ).toBeInTheDocument();
  });
});
