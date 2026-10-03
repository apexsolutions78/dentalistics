import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter } from './router';
import { AuthProvider } from '../lib/auth';
import type { SessionOrganization, SessionUser } from '../lib/types';
import {
  makeSettings,
  makeUser,
  makeOrganization,
  makePlans,
  jsonResponse,
  mockFetch,
} from '../test/fixtures';

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
    trends: { daily: [] },
  };
}

function routeFor(user: SessionUser | null, organization?: SessionOrganization | null) {
  return (url: string): Response => {
    if (url.includes('/api/auth/me')) {
      return user === null
        ? jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
        : jsonResponse(200, {
            user,
            organization:
              organization ??
              (user.organizationId === null ? null : makeOrganization()),
          });
    }
    if (url.includes('/api/public/plans')) {
      return jsonResponse(200, { plans: makePlans() });
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
    if (url.includes('/api/admin/trials')) {
      return jsonResponse(200, { trials: [] });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

async function renderAt(
  path: string,
  user: SessionUser | null,
  organization?: SessionOrganization | null,
): Promise<void> {
  mockFetch(routeFor(user, organization));
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

  it('shows a no-clinic message on the dashboard for an account without a clinic', async () => {
    await renderAt('/dashboard', makeUser({ role: 'admin', email: 'admin@example.com', organizationId: null }));
    expect(
      await screen.findByRole('heading', { name: 'No clinic linked to this account' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('shows the no-clinic message on settings for an account without a clinic', async () => {
    await renderAt('/settings', makeUser({ role: 'admin', email: 'admin@example.com', organizationId: null }));
    expect(
      await screen.findByRole('heading', { name: 'No clinic linked to this account' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('sends anonymous visitors to the login page', async () => {
    await renderAt('/settings', null);
    expect(await screen.findByText('Sign in to your clinic account')).toBeInTheDocument();
  });

  it('shows the public pricing page to anonymous visitors at "/"', async () => {
    await renderAt('/', null);
    expect(await screen.findByRole('heading', { name: 'Run your dental clinic from one place' })).toBeInTheDocument();
    expect(await screen.findByText('Free Plan')).toBeInTheDocument();
    expect(await screen.findByText('Full Plan')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Start free trial/i }).length).toBeGreaterThan(0);
  });

  it('sends a clinic with unfinished onboarding to the setup wizard', async () => {
    await renderAt(
      '/dashboard',
      makeUser({ role: 'owner' }),
      makeOrganization({ onboardingCompletedAt: null }),
    );
    expect(await screen.findByRole('heading', { name: 'Set up your clinic' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('keeps a clinic with completed onboarding on the dashboard', async () => {
    await renderAt('/dashboard', makeUser({ role: 'owner' }), makeOrganization());
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up your clinic' })).not.toBeInTheDocument();
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

  it('lets the platform administrator open the trials screen', async () => {
    await renderAt(
      '/admin/trials',
      makeUser({ role: 'admin', email: 'platform@example.com', organizationId: null }),
    );
    expect(await screen.findByRole('heading', { name: 'Trial clinics' })).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });

  it('denies a clinic owner the trials screen', async () => {
    await renderAt('/admin/trials', makeUser({ role: 'owner' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('denies a receptionist the trials screen', async () => {
    await renderAt('/admin/trials', makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('shows the read-only lock banner after the trial expires', async () => {
    await renderAt(
      '/dashboard',
      makeUser({ role: 'owner' }),
      makeOrganization({ plan: 'trial', trialEndsAt: '2020-01-01T00:00:00.000Z' }),
    );
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText(/Free trial ended/)).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });

  it('shows no lock banner while the trial is still active', async () => {
    await renderAt(
      '/dashboard',
      makeUser({ role: 'owner' }),
      makeOrganization({ plan: 'trial', trialEndsAt: '2099-01-01T00:00:00.000Z' }),
    );
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText(/Free trial ended/)).not.toBeInTheDocument();
  });

  it('keeps an expired trial out of the onboarding wizard', async () => {
    await renderAt(
      '/dashboard',
      makeUser({ role: 'owner' }),
      makeOrganization({
        plan: 'trial',
        trialEndsAt: '2020-01-01T00:00:00.000Z',
        onboardingCompletedAt: null,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Set up your clinic' })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });
});
