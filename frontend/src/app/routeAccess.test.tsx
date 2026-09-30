import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './router';
import { AuthProvider } from '../lib/auth';
import type { SessionUser } from '../lib/types';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function routeFor(user: SessionUser | null) {
  return (url: string): Response => {
    if (url.includes('/api/auth/me')) {
      return user === null
        ? jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
        : jsonResponse(200, { user });
    }
    if (url.includes('/settings')) {
      return jsonResponse(200, { settings: makeSettings() });
    }
    if (url.includes('/users')) {
      return jsonResponse(200, { users: [] });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

async function renderAt(path: string, user: SessionUser | null): Promise<void> {
  mockFetch(routeFor(user));
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('route access', () => {
  it('lets an owner open the settings overview', async () => {
    await renderAt('/settings', makeUser({ role: 'owner' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByText('Clinic profile')).toBeInTheDocument();
  });

  it('denies a receptionist access to settings', async () => {
    await renderAt('/settings', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('sends anonymous visitors to the login page', async () => {
    await renderAt('/settings', null);
    expect(await screen.findByText('Sign in to your clinic account')).toBeInTheDocument();
  });

  it('shows the not-found page for unknown routes', async () => {
    await renderAt('/definitely-missing', makeUser({ role: 'owner' }));
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });

  it('renders an honest empty landing without planned screens for receptionists', async () => {
    await renderAt('/', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText(/no screens for your account yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/planned/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Users & roles')).not.toBeInTheDocument();
  });
});
