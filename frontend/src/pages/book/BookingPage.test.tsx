import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BookingPage } from './BookingPage';
import { jsonResponse } from '../../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const clinic = {
  available: true,
  clinic: {
    name: 'Harbour Dental',
    phone: '15550001000',
    address: '1 Quay',
    logoUrl: null,
    timezone: 'UTC',
  },
  booking: {
    slotMinutes: 30,
    minNoticeMinutes: 120,
    maxDaysAhead: 60,
    confirmation: 'pending',
  },
  doctors: [{ id: 7, name: 'Dr Ada', specialty: 'General' }],
  today: '2026-11-06',
  lastDate: '2027-01-05',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/book/abc']}>
      <Routes>
        <Route path="/book/:siteKey" element={<BookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BookingPage', () => {
  it('walks a patient from the reason to a pending confirmation', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/public/booking/abc') && (init?.method ?? 'GET') === 'GET') {
        return Promise.resolve(jsonResponse(200, clinic));
      }
      if (url.includes('/slots')) {
        return Promise.resolve(jsonResponse(200, { date: '2026-11-06', timezone: 'UTC', slots: ['10:00', '10:30'] }));
      }
      const body = JSON.parse(String(init?.body));
      expect(body.companyWebsite).toBe('');
      expect(body.consent).toBe(true);
      expect(body.doctorId).toBe(7);
      expect(body.time).toBe('10:00');
      return Promise.resolve(
        jsonResponse(201, {
          accepted: true,
          appointmentId: 42,
          confirmation: 'pending',
          date: '2026-11-06',
          time: '10:00',
          doctorName: 'Dr Ada',
          clinicName: 'Harbour Dental',
          emailSent: false,
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Harbour Dental' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Reason for visit/ }), 'Cleaning');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Dr Ada/ }));
    await user.click(await screen.findByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Pat Ient');
    await user.type(screen.getByRole('textbox', { name: /Phone/ }), '15551110001');
    await user.type(screen.getByRole('textbox', { name: /Email/ }), 'pat@example.test');
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /contact me about this appointment/i }));
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeInTheDocument();
    expect(screen.getByText(/clinic will confirm this request/i)).toBeInTheDocument();
  });

  it('says online booking is not available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            available: false,
            message: 'Online booking is not available.',
            clinic: { name: 'Harbour Dental', phone: null, address: null, logoUrl: null, timezone: '' },
          }),
        ),
      ),
    );
    renderPage();
    expect(await screen.findByText('Online booking is not available.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Harbour Dental' })).toBeInTheDocument();
  });
});
