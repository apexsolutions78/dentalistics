import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { LeadsPage } from './leads/LeadsPage';
import { LeadDetailPage } from './leads/LeadDetailPage';
import { PatientsPage } from './patients/PatientsPage';
import { RecallPage } from './recall/RecallPage';
import { CommunicationsPage } from './communications/CommunicationsPage';
import { AppointmentDetailPage } from './appointments/AppointmentDetailPage';
import { DashboardPage } from './dashboard/DashboardPage';
import { makeUser, jsonResponse } from '../test/fixtures';
import type { SessionUser } from '../lib/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = (url: string, init?: RequestInit) => Response | null;

function stub(handler: Handler, user: SessionUser | null = makeUser()): ReturnType<typeof vi.fn> {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        user === null
          ? jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } })
          : jsonResponse(200, { user }),
      );
    }
    const res = handler(url, init);
    return Promise.resolve(
      res ?? jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage(ui: ReactElement, entry = '/'): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/appointments/:appointmentId" element={ui} />
          <Route path="/leads/:leadId" element={ui} />
          <Route path="/patients/:patientId" element={ui} />
          <Route path="*" element={ui} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const leadRow = {
  id: 7,
  organizationId: 1,
  firstName: 'Sara',
  lastName: 'Halim',
  phone: '+15550300001',
  email: null,
  requestedService: 'Cleaning',
  source: 'WEBSITE',
  status: 'NEW',
  assignedUserId: null,
  assignedUserEmail: null,
  notes: null,
  lastActivityAt: null,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

const recallRow = {
  id: 4,
  patientId: 2,
  patient: { id: 2, firstName: 'Omar', lastName: 'Nasser', phone: '+15550300002' },
  recallType: 'hygiene',
  dueDate: '2026-10-05',
  status: 'DUE',
  lastContactedAt: null,
  rebookedAppointmentId: null,
  anchorAppointmentId: null,
  closeReason: null,
  openedAt: null,
  closedAt: null,
  createdAt: null,
  updatedAt: null,
};

const appointment = {
  id: 5,
  organizationId: 1,
  patientId: 2,
  leadId: null,
  date: '2026-10-06',
  time: '10:00',
  status: 'SCHEDULED',
  service: 'Cleaning',
  provider: null,
  previousAppointmentId: null,
  patient: { id: 2, firstName: 'Omar', lastName: 'Nasser', phone: '+15550300002' },
  createdBy: 1,
  createdAt: '2026-09-30T10:00:00.000Z',
  updatedAt: '2026-09-30T10:00:00.000Z',
};

function jsonIf(match: string, body: unknown): Handler {
  return (url) => (url.includes(match) ? jsonResponse(200, body) : null);
}

describe('LeadsPage', () => {
  it('renders lead rows from the API', async () => {
    stub(jsonIf('/leads?', { leads: [leadRow], total: 1, limit: 20, offset: 0 }));
    renderPage(<LeadsPage />, '/leads');
    expect(await screen.findByRole('link', { name: 'Sara Halim' })).toBeInTheDocument();
    expect(screen.getByText('+15550300001')).toBeInTheDocument();
    expect(screen.getByText('WEBSITE')).toBeInTheDocument();
    expect(screen.getByText('Cleaning')).toBeInTheDocument();
  });

  it('shows the empty state when there are no leads', async () => {
    stub(jsonIf('/leads?', { leads: [], total: 0, limit: 20, offset: 0 }));
    renderPage(<LeadsPage />, '/leads');
    expect(await screen.findByText('No leads found')).toBeInTheDocument();
  });

  it('shows a retryable error state when the API fails', async () => {
    stub(() => jsonResponse(500, { error: { code: 'internal', message: 'Database unavailable' } }));
    renderPage(<LeadsPage />, '/leads');
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('RecallPage', () => {
  const recallHandler = jsonIf('/recalls?', {
    recalls: [recallRow],
    total: 1,
    limit: 20,
    offset: 0,
  });

  it('lets an owner close recalls', async () => {
    stub(recallHandler, makeUser({ role: 'owner' }));
    renderPage(<RecallPage />, '/recall');
    expect(await screen.findByRole('link', { name: 'Omar Nasser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book' })).toBeInTheDocument();
  });

  it('hides the close action from receptionists', async () => {
    stub(recallHandler, makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    renderPage(<RecallPage />, '/recall');
    expect(await screen.findByRole('link', { name: 'Omar Nasser' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact' })).toBeInTheDocument();
  });

  it('opens the close confirmation with a reason picker', async () => {
    stub(recallHandler, makeUser({ role: 'owner' }));
    renderPage(<RecallPage />, '/recall');
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Close this recall?')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Reason/ })).toBeInTheDocument();
  });
});

describe('CommunicationsPage', () => {
  const message = {
    id: 9,
    organizationId: 1,
    channel: 'WHATSAPP',
    direction: 'OUTBOUND',
    messageType: 'TEXT',
    recipient: '+15550300001',
    body: 'Your appointment is confirmed.',
    status: 'DELIVERED',
    template: 'appointment_confirmation',
    leadId: null,
    appointmentId: null,
    attempts: 1,
    idempotencyKey: 'k1',
    sentAt: '2026-09-30T10:05:00.000Z',
    deliveredAt: '2026-09-30T10:05:05.000Z',
    createdAt: '2026-09-30T10:05:00.000Z',
    updatedAt: '2026-09-30T10:05:05.000Z',
  };

  it('lists messages and expands a row to show the body', async () => {
    stub(jsonIf('/communications?', { messages: [message], total: 1, limit: 20, offset: 0 }));
    renderPage(<CommunicationsPage />, '/communications');
    expect(await screen.findByText('+15550300001')).toBeInTheDocument();
    expect(screen.queryByText('Your appointment is confirmed.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByText('Your appointment is confirmed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('shows the filtered-empty state', async () => {
    stub(jsonIf('/communications?', { messages: [], total: 0, limit: 20, offset: 0 }));
    renderPage(<CommunicationsPage />, '/communications?recipient=%2B1555');
    expect(await screen.findByText('No messages found')).toBeInTheDocument();
    expect(screen.getByText('No messages match the current filters. Try resetting them.')).toBeInTheDocument();
  });
});

describe('AppointmentDetailPage', () => {
  const handler = (withAutomations: boolean): Handler => {
    return (url) => {
      if (url.includes('/appointments/5') && !url.includes('?')) {
        return jsonResponse(200, { appointment });
      }
      if (url.includes('/communications?')) {
        return jsonResponse(200, { messages: [], total: 0, limit: 50, offset: 0 });
      }
      if (withAutomations && url.includes('/observability/automation-logs?')) {
        return jsonResponse(200, { logs: [], total: 0, limit: 20, offset: 0 });
      }
      return null;
    };
  };

  it('shows confirm for every member but cancel only for managers', async () => {
    stub(handler(true), makeUser({ role: 'owner' }));
    renderPage(<AppointmentDetailPage />, '/appointments/5');
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel appointment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeInTheDocument();
    expect(screen.getAllByText('Cleaning').length).toBeGreaterThan(0);
  });

  it('keeps cancel and complete away from receptionists', async () => {
    stub(handler(false), makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    renderPage(<AppointmentDetailPage />, '/appointments/5');
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark no-show' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel appointment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument();
  });
});

describe('DashboardPage', () => {
  it('shows a retryable error state when the dashboard API fails', async () => {
    stub(() => jsonResponse(403, { error: { code: 'forbidden', message: 'Forbidden' } }));
    renderPage(<DashboardPage />, '/dashboard');
    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('LeadDetailPage workflow actions', () => {
  const leadDetail = {
    lead: leadRow,
    notes: null,
    activity: [],
    communicationHistory: [],
    appointments: [],
  };

  it('offers Convert to patient with the lead details prefilled', async () => {
    stub(jsonIf('/leads/7', leadDetail), makeUser({ role: 'owner' }));
    renderPage(<LeadDetailPage />, '/leads/7');
    const link = await screen.findByRole('link', { name: 'Convert to patient' });
    expect(link).toHaveAttribute(
      'href',
      '/patients?new=1&leadId=7&firstName=Sara&lastName=Halim&phone=%2B15550300001',
    );
    expect(screen.getByText(/Next steps: contact the lead/)).toBeInTheDocument();
  });

  it('keeps Convert to patient away from receptionists', async () => {
    stub(
      jsonIf('/leads/7', leadDetail),
      makeUser({ role: 'receptionist', email: 'desk@example.com' }),
    );
    renderPage(<LeadDetailPage />, '/leads/7');
    await screen.findByRole('link', { name: 'Book appointment' });
    expect(screen.queryByRole('link', { name: 'Convert to patient' })).not.toBeInTheDocument();
  });
});

describe('PatientsPage lead conversion', () => {
  it('opens the add-patient form prefilled from the lead', async () => {
    stub(
      jsonIf('/patients?', { patients: [], total: 0, limit: 20, offset: 0 }),
      makeUser({ role: 'owner' }),
    );
    renderPage(
      <PatientsPage />,
      '/patients?new=1&leadId=7&firstName=Sara&lastName=Halim&phone=%2B15550300001&email=sara%40example.com',
    );
    expect(await screen.findByText('Add a patient')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sara')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Halim')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+15550300001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sara@example.com')).toBeInTheDocument();
  });

  it('keeps the add-patient form closed for a receptionist', async () => {
    stub(
      jsonIf('/patients?', { patients: [], total: 0, limit: 20, offset: 0 }),
      makeUser({ role: 'receptionist', email: 'desk@example.com' }),
    );
    renderPage(<PatientsPage />, '/patients?new=1&firstName=Sara');
    await screen.findByText('All patients');
    expect(screen.queryByText('Add a patient')).not.toBeInTheDocument();
  });
});
