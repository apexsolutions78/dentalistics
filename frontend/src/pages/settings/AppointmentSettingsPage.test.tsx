import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { AppointmentSettingsPage } from './AppointmentSettingsPage';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseRoutes(patchHandler?: (body: unknown) => Response) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse(200, { user: makeUser() });
    }
    if (url.includes('/settings/automations/reminder') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as unknown;
      return patchHandler !== undefined
        ? patchHandler(body)
        : jsonResponse(200, { settings: makeSettings() });
    }
    if (url.includes('/settings')) {
      return jsonResponse(200, { settings: makeSettings() });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

describe('AppointmentSettingsPage', () => {
  it('shows reminder settings from the server', async () => {
    mockFetch(baseRoutes());
    render(
      <MemoryRouter><AuthProvider><AppointmentSettingsPage /></AuthProvider></MemoryRouter>,
    );
    expect(await screen.findByLabelText('Reminder offsets (hours before the appointment)')).toHaveValue('48, 24, 2');
    expect(screen.getByLabelText('Provider')).toHaveValue('mock');
    expect(screen.getByLabelText('Quiet from')).toHaveValue('21:00');
  });

  it('saves parsed reminder offsets', async () => {
    let patchBody: Record<string, unknown> | null = null;
    mockFetch(
      baseRoutes((body) => {
        patchBody = body as Record<string, unknown>;
        return jsonResponse(200, { settings: makeSettings() });
      }),
    );
    render(
      <MemoryRouter><AuthProvider><AppointmentSettingsPage /></AuthProvider></MemoryRouter>,
    );
    const offsets = await screen.findByLabelText('Reminder offsets (hours before the appointment)');
    fireEvent.change(offsets, { target: { value: '24, 6, 6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Reminder settings saved.');
    expect(patchBody).not.toBeNull();
    const body = patchBody as unknown as Record<string, unknown>;
    expect(body.offsetsHours).toEqual([24, 6]);
    expect(body.quietHours).toEqual({ enabled: false, start: '21:00', end: '08:00' });
    expect(body.maxAttempts).toBeUndefined();
  });

  it('rejects invalid offsets without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(baseRoutes()(String(input), init)),
    );
    render(
      <MemoryRouter><AuthProvider><AppointmentSettingsPage /></AuthProvider></MemoryRouter>,
    );
    const offsets = await screen.findByLabelText('Reminder offsets (hours before the appointment)');
    fireEvent.change(offsets, { target: { value: 'soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/is not a whole number of hours/);
    const patchCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });
});
