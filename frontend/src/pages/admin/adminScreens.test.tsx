import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { WebhooksPage } from './WebhooksPage';
import { AutomationFailuresPage } from './AutomationFailuresPage';
import { AuditLogPage } from './AuditLogPage';
import { TrialsPage } from './TrialsPage';
import { makeUser, makeMembers, jsonResponse } from '../../test/fixtures';

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

function renderPage(ui: ReactElement): void {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
}

const webhookEvents = {
  events: [
    {
      id: 1,
      source: 'whatsapp',
      request_method: 'POST',
      http_status: 200,
      outcome: 'processed',
      provider_key: 'wa-prod',
      detail: null,
      created_at: '2026-10-01T09:00:00.000Z',
    },
    {
      id: 2,
      source: 'telephony',
      request_method: 'POST',
      http_status: 200,
      outcome: 'duplicate',
      provider_key: 'tel-1',
      detail: 'event 42 already handled',
      created_at: '2026-10-01T09:05:00.000Z',
    },
    {
      id: 3,
      source: 'whatsapp',
      request_method: 'POST',
      http_status: 401,
      outcome: 'invalid_signature',
      provider_key: null,
      detail: null,
      created_at: '2026-10-01T09:06:00.000Z',
    },
  ],
  total: 3,
  limit: 25,
  offset: 0,
};

const failedJob = {
  kind: 'reminder',
  id: 3,
  status: 'FAILED',
  attempts: 3,
  error: 'provider_timeout',
  message_id: 9,
  updated_at: '2026-10-01T10:00:00.000Z',
};

const auditLogs = {
  logs: [
    {
      id: 1,
      organization_id: 1,
      user_id: 2,
      action: 'settings_updated',
      detail: 'target=clinic',
      created_at: '2026-10-01T11:00:00.000Z',
    },
    {
      id: 2,
      organization_id: 1,
      user_id: null,
      action: 'auth_failed',
      detail: 'reason=invalid_credentials',
      created_at: '2026-10-01T11:05:00.000Z',
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
};

describe('WebhooksPage', () => {
  it('lists received webhook events with provider, outcome and idempotency', async () => {
    stub((url) =>
      url.includes('/observability/webhook-logs')
        ? jsonResponse(200, webhookEvents)
        : null,
    );
    renderPage(<WebhooksPage />);
    expect(await screen.findByText('wa-prod')).toBeInTheDocument();
    const table = screen.getByRole('region', { name: 'Webhook activity table' });
    expect(within(table).getAllByText('WhatsApp')).toHaveLength(2);
    expect(screen.getByText('processed (HTTP 200)')).toBeInTheDocument();
    expect(screen.getByText('Unique')).toBeInTheDocument();
    expect(screen.getByText('Duplicate ignored')).toBeInTheDocument();
    expect(screen.getByText('event 42 already handled')).toBeInTheDocument();
    expect(screen.getByText('HTTP 401')).toBeInTheDocument();
    expect(screen.getByText('invalid_signature (HTTP 401)')).toBeInTheDocument();
  });

  it('shows the empty state when no events were received', async () => {
    stub((url) =>
      url.includes('/observability/webhook-logs')
        ? jsonResponse(200, { events: [], total: 0, limit: 25, offset: 0 })
        : null,
    );
    renderPage(<WebhooksPage />);
    expect(await screen.findByText('No webhook events')).toBeInTheDocument();
  });

  it('reloads the list with the source filter applied', async () => {
    const fn = stub((url) =>
      url.includes('/observability/webhook-logs')
        ? jsonResponse(200, webhookEvents)
        : null,
    );
    renderPage(<WebhooksPage />);
    await screen.findByText('wa-prod');
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), {
      target: { value: 'whatsapp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(
        fn.mock.calls.some(([input]) => String(input).includes('source=whatsapp')),
      ).toBe(true);
    });
  });
});

describe('AutomationFailuresPage', () => {
  it('lists failed jobs with their failure detail and retry action', async () => {
    stub((url) =>
      url.includes('/observability/failed-jobs') && !url.includes('/reminder/')
        ? jsonResponse(200, { jobs: [failedJob], total: 1, limit: 25, offset: 0 })
        : null,
    );
    renderPage(<AutomationFailuresPage />);
    expect(await screen.findByText('Appointment reminder')).toBeInTheDocument();
    expect(screen.getByText(/message #9/)).toBeInTheDocument();
    expect(screen.getByText('provider_timeout')).toBeInTheDocument();
    expect(screen.getByText('3 attempts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('retries a failed job and reports the outcome', async () => {
    const fn = stub((url, init) => {
      if (url.includes('/observability/failed-jobs/reminder/3') && init?.method === 'POST') {
        return jsonResponse(200, { retry: { kind: 'reminder', id: 3, action: 'sent' } });
      }
      if (url.includes('/observability/failed-jobs')) {
        return jsonResponse(200, { jobs: [failedJob], total: 1, limit: 25, offset: 0 });
      }
      return null;
    });
    renderPage(<AutomationFailuresPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/sent on retry/)).toBeInTheDocument();
    expect(
      fn.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/failed-jobs/reminder/3') && init?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('shows the empty state when nothing has failed', async () => {
    stub((url) =>
      url.includes('/observability/failed-jobs')
        ? jsonResponse(200, { jobs: [], total: 0, limit: 25, offset: 0 })
        : null,
    );
    renderPage(<AutomationFailuresPage />);
    expect(await screen.findByText('No failed jobs')).toBeInTheDocument();
  });
});

describe('AuditLogPage', () => {
  it('lists audit records with the acting member resolved from the member list', async () => {
    stub((url) => {
      if (url.includes('/observability/audit-logs')) return jsonResponse(200, auditLogs);
      if (url.includes('/users')) return jsonResponse(200, { users: makeMembers() });
      return null;
    });
    renderPage(<AuditLogPage />);
    expect(await screen.findByText('desk@example.com')).toBeInTheDocument();
    expect(screen.getByText('settings_updated')).toBeInTheDocument();
    expect(screen.getByText('target=clinic')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('auth_failed')).toBeInTheDocument();
    expect(screen.getByText('invalid_credentials')).toBeInTheDocument();
  });

  it('shows the empty state when no audit records exist', async () => {
    stub((url) => {
      if (url.includes('/observability/audit-logs')) {
        return jsonResponse(200, { logs: [], total: 0, limit: 25, offset: 0 });
      }
      if (url.includes('/users')) return jsonResponse(200, { users: makeMembers() });
      return null;
    });
    renderPage(<AuditLogPage />);
    expect(await screen.findByText('No audit records')).toBeInTheDocument();
  });
});

const trialsList = {
  trials: [
    { id: 11, name: 'Expired Dental', status: 'active', trialEndsAt: '2020-01-01T00:00:00.000Z' },
    { id: 12, name: 'Active Dental', status: 'active', trialEndsAt: '2099-01-01T00:00:00.000Z' },
  ],
};

describe('TrialsPage', () => {
  it('lists trial clinics with active and expired states', async () => {
    stub((url) => (url.includes('/api/admin/trials') ? jsonResponse(200, trialsList) : null));
    renderPage(<TrialsPage />);
    expect(await screen.findByText('Expired Dental')).toBeInTheDocument();
    expect(screen.getByText('Active Dental')).toBeInTheDocument();
    expect(screen.getByText(/^Expired /, { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText(/^Active until /, { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Activate' })).toHaveLength(2);
  });

  it('activates a trial and refreshes the list', async () => {
    let listCalls = 0;
    const fn = stub((url, init) => {
      if (url.includes('/api/admin/organizations/12/activate') && init?.method === 'POST') {
        return jsonResponse(200, {
          organization: { id: 12, name: 'Active Dental', status: 'active', plan: 'full' },
          activated: true,
        });
      }
      if (url.includes('/api/admin/trials')) {
        listCalls += 1;
        return jsonResponse(200, listCalls === 1 ? trialsList : { trials: [trialsList.trials[0]] });
      }
      return null;
    });
    renderPage(<TrialsPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Activate' });
    const activeButton = buttons[1];
    if (activeButton === undefined) throw new Error('expected two activate buttons');
    fireEvent.click(activeButton);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Active Dental is now on the Full Plan.',
    );
    expect(
      fn.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/api/admin/organizations/12/activate') &&
          init?.method === 'POST',
      ),
    ).toBe(true);
    expect(
      fn.mock.calls.filter(([input]) => String(input).includes('/api/admin/trials')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('Expired Dental')).toBeInTheDocument();
  });

  it('shows an activation failure from the API', async () => {
    stub((url, init) => {
      if (url.includes('/activate') && init?.method === 'POST') {
        return jsonResponse(403, { error: { code: 'forbidden', message: 'Forbidden' } });
      }
      if (url.includes('/api/admin/trials')) {
        return jsonResponse(200, { trials: [trialsList.trials[0]] });
      }
      return null;
    });
    renderPage(<TrialsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });

  it('shows the empty state when there are no trials', async () => {
    stub((url) => (url.includes('/api/admin/trials') ? jsonResponse(200, { trials: [] }) : null));
    renderPage(<TrialsPage />);
    expect(await screen.findByText('No trial clinics')).toBeInTheDocument();
  });
});
