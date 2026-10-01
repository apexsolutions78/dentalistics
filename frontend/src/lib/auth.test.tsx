import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth';
import { apiFetch } from './api';
import { makeUser, jsonResponse, mockFetch } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe() {
  const { status, sessionExpired } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="expired">{String(sessionExpired)}</span>
      <button
        type="button"
        onClick={() => {
          void apiFetch('/api/organizations/1/patients').catch(() => undefined);
        }}
      >
        call
      </button>
    </div>
  );
}

describe('session expiry', () => {
  it('marks the session expired when an authenticated request returns 401', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return jsonResponse(200, { user: makeUser() });
      }
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    fireEvent.click(screen.getByRole('button', { name: 'call' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('expired')).toHaveTextContent('true');
  });

  it('does not treat the initial session check as an expired session', async () => {
    mockFetch(() => jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });

  it('does not flag a failed sign-in attempt as an expired session', async () => {
    mockFetch((url, init) => {
      if (url.includes('/api/auth/me')) {
        return jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return jsonResponse(401, { error: { code: 'invalid_credentials', message: 'Incorrect email or password' } });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
    });
    function LoginProbe() {
      const { status, sessionExpired } = useAuth();
      return (
        <div>
          <span data-testid="status">{status}</span>
          <span data-testid="expired">{String(sessionExpired)}</span>
          <button
            type="button"
            onClick={() => {
              void apiFetch('/api/auth/login', { method: 'POST', body: {} }).catch(() => undefined);
            }}
          >
            try-login
          </button>
        </div>
      );
    }
    render(
      <AuthProvider>
        <LoginProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    fireEvent.click(screen.getByRole('button', { name: 'try-login' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
    expect(screen.getByTestId('expired')).toHaveTextContent('false');
  });
});
