import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { LoginPage } from '../LoginPage';
import { jsonResponse } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function routeFor(outcome: 'sent' | 'rate_limited' | 'reset_ok' | 'reset_invalid') {
  return (url: string): Response => {
    if (url.includes('/forgot-password')) {
      return outcome === 'rate_limited'
        ? jsonResponse(429, {
            error: { code: 'rate_limited', message: 'Too many reset requests, try again later' },
          })
        : jsonResponse(200, {
            message: 'If an account exists for that email, a password reset link has been sent.',
          });
    }
    if (url.includes('/reset-password')) {
      return outcome === 'reset_invalid'
        ? jsonResponse(400, {
            error: { code: 'invalid_reset_token', message: 'Reset link is invalid or has expired' },
          })
        : jsonResponse(200, { ok: true });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

describe('ForgotPasswordPage', () => {
  it('submits the email and shows the generic success message', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(routeFor('sent')(String(input))),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AuthProvider>
          <ForgotPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText('If an account exists for that email, a password reset link has been sent.'),
    ).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/forgot-password'));
    expect(call).toBeDefined();
    const init = (call as unknown as [RequestInfo | URL, RequestInit?])[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ email: 'owner@example.com' }));
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('shows a local error for an empty email without calling the API', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(routeFor('sent')(String(input))),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AuthProvider>
          <ForgotPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your account email.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('forgot-password'))).toBe(false);
  });

  it('surfaces the rate-limit response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(routeFor('rate_limited')(String(input))),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/forgot-password']}>
        <AuthProvider>
          <ForgotPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Too many reset requests, try again later')).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('shows the invalid-link state without a token', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthProvider>
          <ResetPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This reset link is not valid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set new password' })).not.toBeInTheDocument();
  });

  it('validates password length and confirmation before submitting', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(routeFor('reset_ok')(String(input))),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/reset-password?token=abc123']}>
        <AuthProvider>
          <ResetPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/New password/), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(
      await screen.findByText('Password must be between 12 and 200 characters.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('reset-password'))).toBe(false);

    fireEvent.change(screen.getByLabelText(/New password/), { target: { value: 'longenoughpass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('reset-password'))).toBe(false);
  });

  it('submits the token and password and continues to sign-in', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(routeFor('reset_ok')(String(input))),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/reset-password?token=abc123']}>
        <AuthProvider>
          <Routes>
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/login" element={<div>LOGIN_PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/New password/), { target: { value: 'longenoughpass1' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'longenoughpass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText('LOGIN_PAGE')).toBeInTheDocument();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/reset-password'));
    expect(call).toBeDefined();
    const init = (call as unknown as [RequestInfo | URL, RequestInit?])[1];
    expect(init?.body).toBe(JSON.stringify({ token: 'abc123', password: 'longenoughpass1' }));
  });

  it('shows the API error for an invalid or expired token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(routeFor('reset_invalid')(String(input))),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/reset-password?token=stale']}>
        <AuthProvider>
          <ResetPasswordPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/New password/), { target: { value: 'longenoughpass1' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'longenoughpass1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Reset link is invalid or has expired')).toBeInTheDocument();
  });
});

describe('LoginPage forgot-password entry', () => {
  it('links to the forgot-password page and shows the reset success flash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }))),
    );
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { passwordReset: true } }]}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Password updated. Sign in with your new password.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Apex Dentalistics' })).toBeInTheDocument());
  });
});
