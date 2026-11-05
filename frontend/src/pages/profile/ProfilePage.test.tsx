import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { makeOrganization, makeUser, jsonResponse } from '../../test/fixtures';
import type { SessionUser } from '../../lib/types';
import { ProfilePage } from './ProfilePage';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface ClinicFields {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

function renderProfile(user: SessionUser, clinic: ClinicFields | null): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        jsonResponse(200, {
          user,
          organization: user.organizationId === null ? null : makeOrganization(),
        }),
      );
    }
    if (url.includes('/api/profile') && (init?.method ?? 'GET') === 'GET') {
      return Promise.resolve(
        jsonResponse(200, {
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId,
            displayName: user.displayName ?? null,
            phone: user.phone ?? null,
          },
          clinic,
        }),
      );
    }
    if (url.includes('/api/profile') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { email?: string; displayName?: string };
      return Promise.resolve(
        jsonResponse(200, {
          user: {
            id: user.id,
            email: body.email ?? user.email,
            role: user.role,
            organizationId: user.organizationId,
            displayName: body.displayName ?? user.displayName ?? null,
            phone: user.phone ?? null,
          },
          clinic,
        }),
      );
    }
    if (url.includes('/api/auth/password')) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    if (url.includes('/api/auth/logout')) {
      return Promise.resolve(jsonResponse(200, { ok: true }));
    }
    return Promise.resolve(jsonResponse(404, { error: { message: 'Not found' } }));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <AuthProvider>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/login" element={<h1>Sign in</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('profile page', () => {
  it('lets an owner edit personal details and clinic contact details', async () => {
    renderProfile(makeUser({ role: 'owner', displayName: 'Avery Owner', phone: '9730000000' }), {
      name: 'Harbour View Dental',
      phone: '9731111111',
      email: 'hello@harbourview.dental',
      address: '12 Marina Road',
    });
    expect(await screen.findByDisplayValue('Avery Owner')).toBeVisible();
    expect(screen.getByLabelText(/Clinic name/)).toHaveValue('Harbour View Dental');
    expect(screen.getByRole('link', { name: 'Clinic settings' })).toHaveAttribute('href', '/settings/clinic');
    expect(screen.getByRole('button', { name: 'Save clinic' })).toBeVisible();
  });

  it('hides clinic fields from a receptionist', async () => {
    renderProfile(makeUser({ role: 'receptionist', email: 'desk@example.com', displayName: 'Dana Desk' }), null);
    expect(await screen.findByDisplayValue('Dana Desk')).toBeVisible();
    expect(screen.queryByLabelText('Clinic name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeVisible();
  });

  it('asks for the current password before changing an email', async () => {
    const user = userEvent.setup();
    const fetchMock = renderProfile(makeUser({ role: 'admin', email: 'admin@example.com', organizationId: null }), null);
    const email = await screen.findByLabelText(/^Email/);
    await user.clear(email);
    await user.type(email, 'new-admin@example.com');
    expect(screen.getByLabelText(/Current password for this email/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save account' }));
    expect(screen.getByText('Enter your current password to change the email.')).toBeVisible();
    expect(fetchMock.mock.calls.some((call) => String(call[1]?.method) === 'PATCH')).toBe(false);
  });

  it('refuses a password change when the confirmation does not match', async () => {
    const user = userEvent.setup();
    const fetchMock = renderProfile(makeUser({ role: 'receptionist', email: 'desk@example.com' }), null);
    await screen.findByLabelText(/^Email/);
    await user.type(screen.getByLabelText(/^New password/), 'new-password-123');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('Passwords do not match.')).toBeVisible();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/auth/password'))).toBe(false);
  });
});
