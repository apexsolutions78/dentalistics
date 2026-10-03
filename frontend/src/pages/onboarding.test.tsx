import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { OnboardingPage } from './OnboardingPage';
import { makeOrganization, makeSettings, makeUser, jsonResponse } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OnboardingPage', () => {
  it('walks the three steps, saves profile and hours, then finishes', async () => {
    let completed = false;
    const user = makeUser({ id: 7, email: 'owner@onboarding.test', role: 'owner', organizationId: 7 });
    const organization = makeOrganization({
      id: 7,
      name: 'Fresh Clinic',
      plan: 'trial',
      onboardingCompletedAt: null,
    });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse(200, {
            user,
            organization: {
              ...organization,
              onboardingCompletedAt: completed ? '2026-10-03T12:00:00.000Z' : null,
            },
          }),
        );
      }
      if (url.includes('/onboarding/complete')) {
        completed = true;
        return Promise.resolve(
          jsonResponse(200, {
            organization: { ...organization, onboardingCompletedAt: '2026-10-03T12:00:00.000Z' },
          }),
        );
      }
      if (url.includes('/settings/clinic')) {
        return Promise.resolve(jsonResponse(200, { settings: makeSettings() }));
      }
      if (url.endsWith('/settings')) {
        return Promise.resolve(jsonResponse(200, { settings: makeSettings() }));
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <AuthProvider>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/dashboard" element={<div>DASHBOARD_PAGE</div>} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Set up your clinic' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3 - Clinic profile')).toBeInTheDocument();
    const nameInput = (await screen.findByLabelText(/Clinic name/)) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe('Test Clinic'));

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Step 2 of 3 - Business hours')).toBeInTheDocument();
    expect(screen.getByText('When is your clinic open? Adjust the defaults if needed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Step 3 of 3 - Review and finish')).toBeInTheDocument();
    expect(screen.getByText('Test Clinic')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByText('DASHBOARD_PAGE')).toBeInTheDocument();

    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const patchCalls = calls.filter(
      (c) => String(c[0]).includes('/settings/clinic') && c[1]?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(2);
    const profileBody = patchCalls[0]?.[1]?.body as string;
    expect(JSON.parse(profileBody)).toMatchObject({ name: 'Test Clinic' });
    const hoursBody = patchCalls[1]?.[1]?.body as string;
    expect(JSON.parse(hoursBody)).toHaveProperty('businessHours');

    const completeCall = calls.find((c) => String(c[0]).includes('/onboarding/complete'));
    expect(completeCall).toBeDefined();
    expect(completeCall?.[1]?.method).toBe('POST');
  });

  it('rejects an invalid clinic email without saving', async () => {
    const user = makeUser({ id: 7, email: 'owner@onboarding.test', role: 'owner', organizationId: 7 });
    const organization = makeOrganization({ id: 7, onboardingCompletedAt: null });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse(200, { user, organization }));
      }
      if (url.includes('/settings')) {
        return Promise.resolve(jsonResponse(200, { settings: makeSettings() }));
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <AuthProvider>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    const emailInput = await screen.findByLabelText(/Contact email/);
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3 - Clinic profile')).toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(
      calls.some((c) => String(c[0]).includes('/settings/clinic') && c[1]?.method === 'PATCH'),
    ).toBe(false);
  });
});
