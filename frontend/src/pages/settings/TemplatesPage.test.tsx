import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../lib/auth';
import { TemplatesPage } from './TemplatesPage';
import { makeSettings, makeUser, jsonResponse, mockFetch } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderTemplates(): void {
  render(
    <MemoryRouter>
      <AuthProvider>
        <TemplatesPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('TemplatesPage', () => {
  it('labels every populated template as configured', async () => {
    const settings = makeSettings();
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return jsonResponse(200, { user: makeUser() });
      }
      if (url.includes('/settings')) {
        return jsonResponse(200, { settings });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
    });
    renderTemplates();
    const configured = await screen.findAllByText('Configured');
    expect(configured).toHaveLength(settings.definitions.templateNames.length);
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
  });

  it('labels an empty template with an empty badge', async () => {
    const settings = makeSettings();
    settings.templates.recall_message = '';
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) {
        return jsonResponse(200, { user: makeUser() });
      }
      if (url.includes('/settings')) {
        return jsonResponse(200, { settings });
      }
      return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
    });
    renderTemplates();
    const emptyBadge = await screen.findByText('Empty');
    expect(emptyBadge).toHaveClass('badge-warn');
    expect(screen.getAllByText('Configured')).toHaveLength(
      settings.definitions.templateNames.length - 1,
    );
  });
});
