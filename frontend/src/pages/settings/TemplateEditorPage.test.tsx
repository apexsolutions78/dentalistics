import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { TemplateEditorPage } from './TemplateEditorPage';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function baseRoutes(patchHandler?: (body: unknown) => Response) {
  return (url: string, init?: RequestInit): Response => {
    if (url.includes('/api/auth/me')) {
      return jsonResponse(200, { user: makeUser() });
    }
    if (init?.method === 'PATCH' && url.includes('/settings/templates/')) {
      const body = JSON.parse(String(init.body)) as unknown;
      return patchHandler !== undefined
        ? patchHandler(body)
        : jsonResponse(200, { settings: makeSettings() });
    }
    if (init?.method === 'POST' && url.includes('/settings/templates/preview')) {
      return jsonResponse(200, { rendered: 'Hello', unknownVariables: [] });
    }
    if (url.includes('/settings')) {
      return jsonResponse(200, { settings: makeSettings() });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  };
}

function renderEditor(): void {
  render(
    <MemoryRouter initialEntries={['/settings/templates/lead_acknowledgement']}>
      <AuthProvider>
        <Routes>
          <Route path="/settings/templates/:templateName" element={<TemplateEditorPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('TemplateEditorPage', () => {
  it('saves the template under the API body key', async () => {
    let patchBody: Record<string, unknown> | null = null;
    mockFetch(
      baseRoutes((body) => {
        patchBody = body as Record<string, unknown>;
        return jsonResponse(200, { settings: makeSettings() });
      }),
    );
    renderEditor();
    const textarea = await screen.findByDisplayValue('ack');
    fireEvent.change(textarea, { target: { value: 'Hello {{first_name}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await screen.findByText('Template saved.');
    expect(patchBody).toEqual({ body: 'Hello {{first_name}}' });
  });

  it('keeps preview on the same body key', async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    mockFetch((url: string, init?: RequestInit): Response => {
      const routes = baseRoutes();
      if (init?.method === 'POST' && url.includes('/settings/templates/preview')) {
        bodies.push({ url, body: JSON.parse(String(init.body)) as unknown });
      }
      return routes(url, init);
    });
    renderEditor();
    const textarea = await screen.findByDisplayValue('ack');
    fireEvent.change(textarea, { target: { value: 'Preview me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Hello');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body).toEqual({ body: 'Preview me' });
  });
});
