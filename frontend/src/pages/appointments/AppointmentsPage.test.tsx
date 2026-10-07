import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AppointmentsPage } from './AppointmentsPage';
import { makeUser, jsonResponse } from '../../test/fixtures';
import type { SessionUser } from '../../lib/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Handler = (url: string, init?: RequestInit) => Response | null;

function stub(handler: Handler, user: SessionUser | null = makeUser()): void {
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
}

function renderPage(entry: string): void {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/appointments" element={<AppointmentsPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const patient = {
  id: 9,
  firstName: 'Milo',
  lastName: 'Caller',
  phone: '+15550710002',
  email: null,
  notes: null,
  smsOptOut: false,
  createdAt: '2026-10-06T10:00:00.000Z',
  updatedAt: '2026-10-06T10:00:00.000Z',
};

function baseHandler(extra?: Handler): Handler {
  return (url) => {
    if (url.includes('/appointments?')) {
      return jsonResponse(200, { appointments: [], total: 0, limit: 20, offset: 0 });
    }
    if (extra !== undefined) {
      const res = extra(url);
      if (res !== null) return res;
    }
    return null;
  };
}

describe('AppointmentsPage booking form', () => {
  it('shows the search hint instead of a permanent spinner before any search', async () => {
    stub(baseHandler());
    renderPage('/appointments?new=1');
    expect(await screen.findByText(/Enter a name or phone to search/)).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });

  it('preselects the patient from the patientId param so booking can start immediately', async () => {
    stub(
      baseHandler((url) =>
        url.includes('/patients/9') ? jsonResponse(200, { patient }) : null,
      ),
    );
    renderPage('/appointments?new=1&patientId=9');
    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByText(/Milo Caller/)).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Book appointment' }),
    ).toBeDisabled();
  });

  it('lets the user search for a patient and pick a result', async () => {
    stub(
      baseHandler((url) =>
        url.includes('/patients?q=Milo')
          ? jsonResponse(200, { patients: [patient], total: 1, limit: 10, offset: 0 })
          : null,
      ),
    );
    renderPage('/appointments?new=1');
    await screen.findByText(/Enter a name or phone to search/);
    fireEvent.change(screen.getByPlaceholderText('Name or phone'), {
      target: { value: 'Milo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const option = await screen.findByRole('option', { name: /Milo Caller/ });
    const select = option.closest('select');
    expect(select).not.toBeNull();
    fireEvent.change(select as HTMLSelectElement, { target: { value: '9' } });
    expect(await screen.findByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).not.toBeInTheDocument();
  });
});
