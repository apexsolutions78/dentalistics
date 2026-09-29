import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '../../lib/auth';
import { ClinicSettingsPage } from './ClinicSettingsPage';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage(): void {
  render(
    <AuthProvider>
      <ClinicSettingsPage />
    </AuthProvider>,
  );
}

function baseRoutes(patchHandler?: (body: unknown) => Response) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse(200, { user: makeUser() });
    }
    if (url.includes('/settings/clinic') && init?.method === 'PATCH') {
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

describe('ClinicSettingsPage', () => {
  it('loads clinic fields and business hours', async () => {
    mockFetch(baseRoutes());
    renderPage();
    expect(await screen.findByLabelText('Clinic name')).toHaveValue('Test Clinic');
    expect(screen.getByLabelText('Monday opening time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Saturday opening time')).toBeDisabled();
  });

  it('saves the full clinic profile including all business-hour keys', async () => {
    let patchBody: Record<string, unknown> | null = null;
    mockFetch(
      baseRoutes((body) => {
        patchBody = body as Record<string, unknown>;
        return jsonResponse(200, { settings: makeSettings() });
      }),
    );
    renderPage();
    const name = await screen.findByLabelText('Clinic name');
    fireEvent.change(name, { target: { value: 'Renamed Clinic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Clinic profile saved.');
    expect(patchBody).not.toBeNull();
    const body = patchBody as unknown as Record<string, unknown>;
    expect(body.name).toBe('Renamed Clinic');
    expect(body.timezone).toBe('Asia/Bahrain');
    const hours = body.businessHours as Record<string, unknown>;
    expect(Object.keys(hours).sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed']);
    expect(hours.sat).toBeNull();
    expect(hours.mon).toEqual({ open: '09:00', close: '17:00' });
  });

  it('rejects business hours where open is not before close without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(baseRoutes()(String(input), init)),
    );
    renderPage();
    const open = await screen.findByLabelText('Monday opening time');
    fireEvent.change(open, { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText(/opening time must be before closing time/i);
    const patchCalls = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('shows a validation error when the clinic name is cleared', async () => {
    mockFetch(baseRoutes());
    renderPage();
    const name = await screen.findByLabelText('Clinic name');
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Clinic name cannot be empty.')).toBeInTheDocument();
  });
});
