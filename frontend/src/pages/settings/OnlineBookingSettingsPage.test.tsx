import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { OnlineBookingSettingsPage } from './OnlineBookingSettingsPage';
import { jsonResponse, makeUser } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const booking = {
  enabled: false,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeMinutes: 120,
  maxDaysAhead: 60,
  autoConfirm: false,
  siteKey: 'ab'.repeat(32),
  path: `/book/${'ab'.repeat(32)}`,
};

describe('OnlineBookingSettingsPage', () => {
  it('shows the public link, a local QR code, and saves owner changes', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse(200, { user: makeUser({ role: 'owner', organizationId: 4 }), organization: null }),
        );
      }
      if ((init?.method ?? 'GET') === 'GET' && url.includes('/booking')) {
        return Promise.resolve(jsonResponse(200, { booking }));
      }
      const body = JSON.parse(String(init?.body));
      expect(body.enabled).toBe(true);
      expect(body.minNoticeMinutes).toBe(120);
      return Promise.resolve(jsonResponse(200, { booking: { ...booking, enabled: true } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <AuthProvider>
          <OnlineBookingSettingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('Booking link')).toHaveValue(
      `${window.location.origin}/book/${'ab'.repeat(32)}`,
    );
    expect(screen.getByRole('img', { name: 'QR code for the booking page' })).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Accept online bookings' }));
    await user.click(screen.getByRole('button', { name: 'Save booking settings' }));
    expect(await screen.findByText('Online booking saved.')).toBeInTheDocument();
  });
});
