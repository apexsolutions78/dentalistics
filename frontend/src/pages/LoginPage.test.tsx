import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { LoginPage } from './LoginPage';
import { makeUser, jsonResponse } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
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

function routesFor(outcome: 'ok' | 'invalid') {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
    }
    if (url.includes('/api/auth/login') && init?.method === 'POST') {
      return outcome === 'ok'
        ? jsonResponse(200, { user: makeUser() })
        : jsonResponse(401, { error: { code: 'invalid_credentials', message: 'Incorrect email or password' } });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

describe('LoginPage', () => {
  it('posts credentials and reports invalid sign-in attempts', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(routesFor('invalid')(String(input), init)),
    );
    renderLogin(fetchMock);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/api/auth/login'),
    );
    expect(loginCall).toBeDefined();
    const init = loginCall?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe(JSON.stringify({ email: 'owner@example.com', password: 'secret12345' }));
  });

  it('clears the session error state after a failed attempt', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(routesFor('invalid')(String(input), init)),
    );
    renderLogin(fetchMock);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('Incorrect email or password');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.queryByText('Incorrect email or password')).not.toBeInTheDocument(),
    );
  });

  it('validates required fields before calling the API and sets the page title', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(routesFor('ok')(String(input), init)),
    );
    renderLogin(fetchMock);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    expect(screen.getByText('Password is required.')).toBeInTheDocument();
    const loginCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/auth/login'));
    expect(loginCalls).toHaveLength(0);
    expect(document.title).toBe('Sign in | Apex Dentalistics');
  });

  it('shows and hides the password', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(routesFor('ok')(String(input), init)),
    );
    renderLogin(fetchMock);

    const field = await screen.findByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('shows a dismissible notice when redirected after the session expired', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(routesFor('ok')(String(input), init)),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { sessionExpired: true } }]}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Your session has expired. Please sign in again.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Your session has expired. Please sign in again.'),
      ).not.toBeInTheDocument(),
    );
  });
});
