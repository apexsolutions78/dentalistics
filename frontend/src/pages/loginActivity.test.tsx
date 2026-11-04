import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../lib/auth';
import { PUBLIC_ACTIVITY_POLL_MS } from '../lib/publicActivity';
import { jsonResponse } from '../test/fixtures';
import { LoginPage } from './LoginPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

function renderLogin(fetchMock: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fetchMock(
  activity: () => Response,
): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(
        jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
      );
    }
    if (url.includes('/api/public/activity')) {
      return Promise.resolve(activity());
    }
    return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
  });
}

const LIVE = {
  events: [
    { kind: 'booking', label: 'A clinic booked a cleaning', minutesAgo: 4, clinicName: 'Smile Studio' },
    { kind: 'enquiry', label: 'New enquiry received', minutesAgo: 12, phone: '+97339990011' },
    { kind: 'reply', label: 'Reply sent', minutesAgo: 0, email: 'patient@example.com' },
  ],
};

describe('login activity cards', () => {
  it('renders live anonymized events and not the old sample cards', async () => {
    renderLogin(fetchMock(() => jsonResponse(200, LIVE)));

    expect(await screen.findByText('A clinic booked a cleaning · 4 min ago')).toBeInTheDocument();
    expect(screen.getByText('New enquiry received · 12 min ago')).toBeInTheDocument();
    expect(screen.getByText('Reply sent · just now')).toBeInTheDocument();
    expect(screen.queryByText('Booked · Thu 10:30')).not.toBeInTheDocument();
    expect(screen.queryByText('New enquiry · cleaning')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Smile Studio');
    expect(document.body.textContent).not.toContain('+97339990011');
    expect(document.body.textContent).not.toContain('patient@example.com');

    const aside = screen.getByRole('complementary', { name: 'Recent clinic activity' });
    expect(aside).not.toHaveAttribute('aria-hidden');
    expect(aside.querySelectorAll('.float-card')).toHaveLength(3);
    expect(aside.querySelector('.float-2')).toBeTruthy();
    expect(aside.querySelector('.float-3')).toBeTruthy();
  });

  it('shows a neutral placeholder when there is no recent activity', async () => {
    renderLogin(fetchMock(() => jsonResponse(200, { events: [] })));
    expect(
      await screen.findByText(
        'Quiet for now. Fresh enquiries, replies, and bookings will float in here.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Reply sent')).not.toBeInTheDocument();
    expect(screen.queryByText('Booked · Thu 10:30')).not.toBeInTheDocument();
  });

  it('shows the placeholder when the feed cannot be loaded', async () => {
    renderLogin(fetchMock(() => jsonResponse(500, { error: { code: 'internal_error', message: 'nope' } })));
    expect(
      await screen.findByText(
        'Quiet for now. Fresh enquiries, replies, and bookings will float in here.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('New enquiry · cleaning')).not.toBeInTheDocument();
  });

  it('drops an event whose label contains a name', async () => {
    renderLogin(
      fetchMock(() =>
        jsonResponse(200, {
          events: [{ kind: 'enquiry', label: 'New enquiry · Priya Shah', minutesAgo: 2, phone: '+973111' }],
        }),
      ),
    );
    expect(
      await screen.findByText(
        'Quiet for now. Fresh enquiries, replies, and bookings will float in here.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Priya');
    expect(document.body.textContent).not.toContain('+973111');
  });

  it('polls on an interval and pauses while the tab is hidden', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    let calls = 0;
    renderLogin(
      fetchMock(() => {
        calls += 1;
        return jsonResponse(200, LIVE);
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Reply sent · just now')).toBeInTheDocument();
    expect(calls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PUBLIC_ACTIVITY_POLL_MS);
    });
    expect(calls).toBe(2);

    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(PUBLIC_ACTIVITY_POLL_MS * 2);
    });
    expect(calls).toBe(2);

    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('A clinic booked a cleaning · 4 min ago')).toBeInTheDocument();
    expect(calls).toBe(3);
  });

  it('still signs in while the activity feed is on the page', async () => {
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/public/activity')) {
        return Promise.resolve(jsonResponse(200, { events: [] }));
      }
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }),
        );
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(401, {
            error: { code: 'invalid_credentials', message: 'Incorrect email or password' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
    });
    renderLogin(mock);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect email or password')).toBeInTheDocument();
  });
});
