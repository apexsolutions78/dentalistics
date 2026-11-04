import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { WorkspacePage } from './workspace/WorkspacePage';
import { jsonResponse, makeUser } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function emptyQueue() {
  return { count: 0, items: [] };
}

describe('remaining empty lists', () => {
  it('offers a sample peek on every empty workspace queue and does not fetch it', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse(200, { user: makeUser() }));
      }
      if (url.includes('/receptionist/workspace')) {
        return Promise.resolve(
          jsonResponse(200, {
            date: '2026-11-04',
            timezone: 'Asia/Dubai',
            generatedAt: '2026-11-04T09:00:00.000Z',
            definitions: {},
            queues: {
              tasks: emptyQueue(),
              newLeads: emptyQueue(),
              missedCalls: emptyQueue(),
              patientReplies: emptyQueue(),
              upcomingAppointments: emptyQueue(),
              noShows: emptyQueue(),
              recallOpportunities: emptyQueue(),
            },
          }),
        );
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <AuthProvider>
          <WorkspacePage />
        </AuthProvider>
      </MemoryRouter>,
    );
    const buttons = await screen.findAllByRole('button', { name: 'Peek at an example' });
    expect(buttons).toHaveLength(7);
    const first = buttons[0];
    if (first === undefined) {
      throw new Error('expected a peek button');
    }
    const callsBeforePeek = fetchMock.mock.calls.length;
    fireEvent.click(first);
    expect(screen.getByText(/Example only/)).toBeInTheDocument();
    expect(screen.getByText(/Not saved data/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforePeek);
  });
});
