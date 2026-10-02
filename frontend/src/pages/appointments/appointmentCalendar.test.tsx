import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AppointmentCalendarPage } from './AppointmentCalendarPage';
import { makeUser, jsonResponse } from '../../test/fixtures';

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

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/appointments/calendar']}>
      <AuthProvider>
        <AppointmentCalendarPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const DAY = 15;

function monthDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${String(DAY).padStart(2, '0')}`;
}

const appointment = {
  id: 5,
  organizationId: 1,
  patientId: 2,
  leadId: null,
  date: monthDate(),
  time: '10:00',
  status: 'SCHEDULED',
  service: 'Cleaning',
  provider: 'Dr. Ray',
  previousAppointmentId: null,
  patient: { id: 2, firstName: 'Omar', lastName: 'Nasser', phone: '+15550300002' },
  createdBy: 1,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

function appointmentsHandler(body: unknown): Handler {
  return (url) => (url.includes('/appointments?from=') ? jsonResponse(200, body) : null);
}

describe('AppointmentCalendarPage', () => {
  it('shows the month grid and opens the selected day', async () => {
    stub(
      appointmentsHandler({
        appointments: [appointment],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    );
    renderPage();
    const cells = await screen.findAllByRole('link', { name: /Omar Nasser/ });
    expect(cells.length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Appointment calendar' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: String(DAY) }));
    expect(await screen.findByRole('link', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByText('Dr. Ray')).toBeInTheDocument();
    expect(screen.getByText('Cleaning')).toBeInTheDocument();
  });

  it('shows the empty state when the month has no appointments', async () => {
    stub(
      appointmentsHandler({
        appointments: [],
        total: 0,
        limit: 100,
        offset: 0,
      }),
    );
    renderPage();
    expect(await screen.findByText('No appointments this month')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('shows a retryable error state when the API fails', async () => {
    stub(() =>
      jsonResponse(500, { error: { code: 'internal', message: 'Database unavailable' } }),
    );
    renderPage();
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
