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

function emptyQueue(): { count: number; items: [] } {
  return { count: 0, items: [] };
}

function makeWorkspace() {
  return {
    date: '2026-10-01',
    timezone: 'Asia/Bahrain',
    generatedAt: '2026-10-01T09:00:00Z',
    queues: {
      newLeads: emptyQueue(),
      missedCalls: emptyQueue(),
      patientReplies: emptyQueue(),
      upcomingAppointments: emptyQueue(),
      noShows: emptyQueue(),
      recallOpportunities: emptyQueue(),
      tasks: emptyQueue(),
    },
    definitions: {},
  };
}

function makeDashboard() {
  return {
    window: { from: '2026-09-24', to: '2026-10-01', basis: '7d' },
    metrics: {
      leads: { new: 0, contacted: 0, converted: 0, responseRate: null },
      leadResponses: 0,
      appointments: { booked: 0, scheduled: 0, confirmed: 0, completed: 0, noShows: 0, rebooked: 0 },
      recall: { due: 0, contacted: 0, booked: 0 },
      messages: { sent: 0, patientReplies: 0 },
      delivery: { delivered: 0, deliveredRate: null },
      failures: { failed: 0, failedRate: null },
    },
    definitions: { metrics: {}, planMetrics: {} },
  };
}

function routeFor(user: SessionUser | null) {
  return (url: string): Response => {
    if (url.includes('/api/auth/me')) {
      return user === null
        ? jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
        : jsonResponse(200, { user });
    }
    if (url.includes('/receptionist/workspace')) {
      return jsonResponse(200, makeWorkspace());
    }
    if (url.includes('/dashboard')) {
      return jsonResponse(200, makeDashboard());
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

  it('sends owners landing on "/" to the dashboard', async () => {
    await renderAt('/', makeUser({ role: 'owner' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Automations')).toBeInTheDocument();
  });

  it('sends receptionists landing on "/" to the workspace without management navigation', async () => {
    await renderAt('/', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.queryByText(/no screens for your account yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Users & roles')).not.toBeInTheDocument();
    expect(screen.queryByText('Automations')).not.toBeInTheDocument();
  });

  it('denies a receptionist access to the dashboard', async () => {
    await renderAt('/dashboard', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist access to automations', async () => {
    await renderAt('/automations', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist access to the webhook screen', async () => {
    await renderAt('/admin/webhooks', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist access to the failed-jobs screen', async () => {
    await renderAt('/admin/automation-failures', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist access to the audit log', async () => {
    await renderAt('/admin/audit', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist access to automation activity', async () => {
    await renderAt('/automations/activity', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('lets an owner open the audit log and the automation activity log', async () => {
    await renderAt('/admin/audit', makeUser({ role: 'owner' }));
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('lets a receptionist open the appointment calendar', async () => {
    await renderAt('/appointments/calendar', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(
      await screen.findByRole('heading', { name: 'Appointment calendar' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('lets every member open the workspace and the leads list', async () => {
    await renderAt('/workspace', makeUser({ role: 'admin', email: 'admin@example.com' }));
    expect(await screen.findByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('shows receptionists the patient list without the create action', async () => {
    await renderAt('/patients', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add patient' })).not.toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('keeps the create action for owners on the patient list', async () => {
    await renderAt('/patients', makeUser({ role: 'owner' }));
    expect(await screen.findByRole('button', { name: 'Add patient' })).toBeInTheDocument();
  });

  it('sends an expired session back to login with a notice', async () => {
    const routes = routeFor(makeUser({ role: 'owner' }));
    mockFetch((url) => {
      if (url.includes('/leads')) {
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
      }
      return routes(url);
    });
    render(
      <MemoryRouter initialEntries={['/leads']}>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Sign in to your clinic account')).toBeInTheDocument();
  });
});
