import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { makeUser, jsonResponse } from '../../test/fixtures';
import type { SessionUser } from '../../lib/types';
import { DRAWER_QUERY } from '../../lib/breakpoints';
import { AppShell } from './AppShell';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function mockDrawer(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query === DRAWER_QUERY ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
}

function renderShell(user: SessionUser): void {
  window.localStorage.setItem(`dentalistics.tour.v1.${user.id}`, 'skipped');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          jsonResponse(200, {
            user,
            organization: user.organizationId === null ? null : { id: 1, name: 'Test Clinic', plan: 'full', trialEndsAt: null, onboardingCompletedAt: '2026-10-01T00:00:00.000Z' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
    }),
  );
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/workspace" element={<h1>Workspace</h1>} />
            <Route path="/leads" element={<h1>Leads</h1>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('clinic navigation drawer', () => {
  it('keeps the sidebar in the page on a desktop width', async () => {
    mockDrawer(false);
    renderShell(makeUser({ role: 'owner' }));
    expect(await screen.findByRole('link', { name: 'Patients' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeVisible();
  });

  it('opens a focus-trapped menu for an owner and closes it', async () => {
    mockDrawer(true);
    const user = userEvent.setup();
    renderShell(makeUser({ role: 'owner' }));
    const toggle = await screen.findByRole('button', { name: 'Menu' });
    expect(screen.queryByRole('link', { name: 'Patients' })).not.toBeInTheDocument();
    expect(screen.getByText('owner@example.com').closest('nav')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(await screen.findByRole('link', { name: 'Patients' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    const close = screen.getByRole('button', { name: 'Close menu' });
    await waitFor(() => expect(close).toHaveFocus());

    expect(screen.getByText('owner@example.com')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    close.focus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Patients' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await screen.findByRole('link', { name: 'Patients' });
    fireEvent.click(document.querySelector('.nav-backdrop') as Element);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Patients' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(await screen.findByRole('link', { name: 'Leads' }));
    expect(await screen.findByRole('heading', { name: 'Leads' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Patients' })).not.toBeInTheDocument());
  });

  it('shows receptionist links and hides owner-only links', async () => {
    mockDrawer(true);
    const user = userEvent.setup();
    renderShell(makeUser({ role: 'receptionist', email: 'desk@example.com' }));
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(await screen.findByRole('link', { name: 'Patients' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Recall' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('shows platform links for an administrator without a clinic', async () => {
    mockDrawer(true);
    const user = userEvent.setup();
    renderShell(makeUser({ role: 'admin', email: 'platform@example.com', organizationId: null }));
    await user.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(await screen.findByRole('link', { name: 'Trials' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Pricing' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Patients' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Clinic tools appear/)).not.toBeInTheDocument();
    expect(screen.getByText('platform@example.com')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Payments' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Manual payments' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Setup help' })).toBeVisible();
  });
});
