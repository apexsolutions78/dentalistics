import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AutomationsPage } from './AutomationsPage';
import { jsonResponse, makeUser } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const flows = [
  {
    key: 'lead_ack',
    name: 'New enquiry acknowledgement',
    description: 'Sends the acknowledgement as soon as a new lead arrives.',
    trigger: 'A lead is created from an allowed source.',
    enabled: true,
    lastRunAt: '2026-11-01T09:00:00.000Z',
    runsLast30Days: 4,
  },
  {
    key: 'reminders',
    name: 'Appointment reminders',
    description: 'Sends the reminder sequence before a visit.',
    trigger: 'A reminder is due for a scheduled appointment.',
    enabled: false,
    lastRunAt: null,
    runsLast30Days: 0,
  },
];

function stub(user = makeUser()): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(jsonResponse(200, { user }));
    }
    if (url.includes('/automation-flows') && init?.method === 'PATCH') {
      return Promise.resolve(jsonResponse(200, { flow: { ...flows[0], enabled: false } }));
    }
    if (url.includes('/automation-flows')) {
      return Promise.resolve(jsonResponse(200, { flows }));
    }
    if (url.includes('/settings')) {
      return Promise.resolve(jsonResponse(200, { settings: { automations: {} } }));
    }
    if (url.includes('/automation-logs')) {
      return Promise.resolve(jsonResponse(200, { logs: [], total: 0, limit: 25, offset: 0 }));
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/automations']}>
      <AuthProvider>
        <AutomationsPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AutomationsPage flows', () => {
  it('shows each flow with its trigger, last run, and 30-day count', async () => {
    stub();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'New enquiry acknowledgement' })).toBeInTheDocument();
    expect(screen.getByText('Trigger: A lead is created from an allowed source.')).toBeInTheDocument();
    expect(screen.getByText(/4 in the last 30 days/)).toBeInTheDocument();
    expect(screen.getByText(/Last run: Never/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'New enquiry acknowledgement enabled' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Appointment reminders enabled' })).not.toBeChecked();
  });

  it('lets the owner turn a flow off', async () => {
    const fn = stub();
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'New enquiry acknowledgement enabled' });
    fireEvent.click(toggle);
    await waitFor(() => {
      const patch = fn.mock.calls.find(
        ([input, init]) => String(input).includes('/automation-flows/lead_ack') && init?.method === 'PATCH',
      );
      expect(patch?.[1]?.body).toBe(JSON.stringify({ enabled: false }));
    });
  });

  it('keeps the switch read-only for a receptionist', async () => {
    stub(makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'New enquiry acknowledgement enabled' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Only the clinic owner can turn a flow on or off.')).toBeInTheDocument();
  });
});
