import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AutomationActivityPage } from './AutomationActivityPage';
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
    <MemoryRouter initialEntries={['/automations/activity']}>
      <AuthProvider>
        <AutomationActivityPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const logRow = {
  id: 11,
  kind: 'reminder',
  status: 'SENT',
  attempts: 1,
  last_error: null,
  suppression_reason: null,
  scheduled_at: '2026-10-01T08:00:00.000Z',
  sent_at: '2026-10-01T08:00:05.000Z',
  subject_id: 5,
};

describe('AutomationActivityPage', () => {
  it('lists automation jobs with their outcome and record link', async () => {
    stub((url) =>
      url.includes('/observability/automation-logs')
        ? jsonResponse(200, { logs: [logRow], total: 1, limit: 25, offset: 0 })
        : null,
    );
    renderPage();
    expect(await screen.findByText('Appointment reminder')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '#5' })).toBeInTheDocument();
    expect(screen.getByText('SENT')).toBeInTheDocument();
    expect(screen.getByText('1 attempt')).toBeInTheDocument();
  });

  it('reloads the list with the status filter applied', async () => {
    const fn = stub((url) =>
      url.includes('/observability/automation-logs')
        ? jsonResponse(200, { logs: [logRow], total: 1, limit: 25, offset: 0 })
        : null,
    );
    renderPage();
    await screen.findByText('Appointment reminder');
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'FAILED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(
        fn.mock.calls.some(([input]) => String(input).includes('status=FAILED')),
      ).toBe(true);
    });
  });

  it('shows the empty state when no jobs match', async () => {
    stub((url) =>
      url.includes('/observability/automation-logs')
        ? jsonResponse(200, { logs: [], total: 0, limit: 25, offset: 0 })
        : null,
    );
    renderPage();
    expect(await screen.findByText('No activity found')).toBeInTheDocument();
  });
});
