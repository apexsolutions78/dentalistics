import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse } from '../../test/fixtures';
import { PatientTimeline } from './PatientTimeline';

afterEach(() => vi.unstubAllGlobals());

describe('PatientTimeline', () => {
  it('lists events newest first and filters by chip', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const type = new URL(url, 'http://localhost').searchParams.get('type');
        const items =
          type === 'appointment'
            ? [
                {
                  id: 'appointment:1',
                  type: 'appointment',
                  at: '2026-11-02T10:00:00.000Z',
                  title: 'Appointment no show',
                  detail: 'Cleaning',
                  href: '/appointments/1',
                },
              ]
            : [
                {
                  id: 'message:2',
                  type: 'message',
                  at: '2026-11-03T10:00:00.000Z',
                  title: 'Outbound SMS sent',
                  detail: null,
                  href: '/communications',
                },
                {
                  id: 'appointment:1',
                  type: 'appointment',
                  at: '2026-11-02T10:00:00.000Z',
                  title: 'Appointment no show',
                  detail: 'Cleaning',
                  href: '/appointments/1',
                },
              ];
        return Promise.resolve(jsonResponse(200, { items, total: items.length, limit: 25, offset: 0 }));
      }),
    );
    render(
      <MemoryRouter>
        <PatientTimeline path="/api/organizations/1/patients/1/timeline" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Outbound SMS sent')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Appointment no show' })).toHaveAttribute('href', '/appointments/1');
    await user.click(screen.getByRole('button', { name: 'appointment' }));
    expect(await screen.findByText('Appointment no show')).toBeInTheDocument();
    expect(screen.queryByText('Outbound SMS sent')).not.toBeInTheDocument();
  });
});
