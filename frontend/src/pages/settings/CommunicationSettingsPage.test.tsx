import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { CommunicationSettingsPage } from './CommunicationSettingsPage';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseRoutes(patchHandler?: (body: unknown) => Response) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse(200, { user: makeUser() });
    }
    if (init?.method === 'PATCH' && url.includes('/settings/providers/whatsapp')) {
      const body = JSON.parse(String(init.body)) as unknown;
      return patchHandler !== undefined
        ? patchHandler(body)
        : jsonResponse(200, { settings: makeSettings() });
    }
    if (init?.method === 'PATCH' && url.includes('/settings/providers/telephony')) {
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

describe('CommunicationSettingsPage', () => {
  it('sends the Graph access token nested under graph, not at the top level', async () => {
    let patchBody: Record<string, unknown> | null = null;
    mockFetch(
      baseRoutes((body) => {
        patchBody = body as Record<string, unknown>;
        return jsonResponse(200, { settings: makeSettings() });
      }),
    );
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommunicationSettingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    const token = await screen.findByLabelText('Graph access token');
    fireEvent.change(token, { target: { value: 'tok-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save WhatsApp' }));
    await screen.findByText('Provider settings saved.');
    expect(patchBody).not.toBeNull();
    const body = patchBody as unknown as Record<string, unknown>;
    expect(body.accessToken).toBeUndefined();
    expect(body.verifyToken).toBeUndefined();
    expect(body.appSecret).toBeUndefined();
    const graph = body.graph as Record<string, unknown>;
    expect(graph.accessToken).toBe('tok-123');
    expect(graph.phoneNumberId).toBe('');
    expect(graph.apiVersion).toBe('v20.0');
  });

  it('shows a visible notice when Clear secrets stages a wipe', async () => {
    mockFetch(baseRoutes());
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommunicationSettingsPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    await screen.findByLabelText('Graph access token');
    expect(screen.queryByText('Secrets will be cleared on save.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear secrets' }));
    expect(await screen.findByText('Secrets will be cleared on save.')).toBeInTheDocument();
  });
});
