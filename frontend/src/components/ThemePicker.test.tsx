import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../lib/auth';
import { setThemeChoice } from '../lib/theme';
import { jsonResponse, makeUser } from '../test/fixtures';
import { ThemePicker } from './ThemePicker';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  setThemeChoice('system');
});

describe('ThemePicker', () => {
  it('saves a dark theme on the account and applies it', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse(200, { user: makeUser({ theme: 'light' }) }));
      }
      if (url.includes('/api/profile') && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse(200, { user: makeUser({ theme: 'dark' }) }));
      }
      return Promise.resolve(jsonResponse(404, { error: { message: 'Not found' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AuthProvider>
        <ThemePicker />
      </AuthProvider>,
    );
    const picker = await screen.findByRole('combobox', { name: 'Theme' });
    await waitFor(() => expect(picker).toHaveValue('light'));
    fireEvent.change(picker, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([input, init]) => String(input).includes('/api/profile') && init?.method === 'PATCH',
      );
      expect(patch?.[1]?.body).toBe(JSON.stringify({ theme: 'dark' }));
    });
  });
});
