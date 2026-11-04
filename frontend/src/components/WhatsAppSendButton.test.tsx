import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WhatsAppSendButton } from './WhatsAppSendButton';
import { jsonResponse } from '../test/fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('WhatsAppSendButton', () => {
  it('logs the reminder and opens the returned wa.me link', async () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal('open', open);
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          url: 'https://wa.me/971501234567?text=Hi%20Layla',
          phoneE164: '+971501234567',
          body: 'Hi Layla',
          template: 'appointment_reminder_48h',
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <WhatsAppSendButton organizationId={4} kind="appointment" subjectId={9} optedOut={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }));

    expect(await screen.findByText('WhatsApp chat opened. The message is logged as sent.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/organizations/4/appointments/9/whatsapp');
    expect(init.method).toBe('POST');
    expect(open).toHaveBeenCalledWith(
      'https://wa.me/971501234567?text=Hi%20Layla',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('does not call the API when the patient has opted out', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<WhatsAppSendButton organizationId={4} kind="recall" subjectId={3} optedOut />);
    const button = screen.getByRole('button', { name: 'Send via WhatsApp' });
    expect(button).toBeDisabled();
    expect(screen.getByText('This patient has opted out of messages.')).toBeInTheDocument();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers the chat link when the browser blocks the new tab', async () => {
    vi.stubGlobal('open', vi.fn(() => null));
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(
        jsonResponse(201, {
          url: 'https://wa.me/971501234567?text=Hi',
          phoneE164: '+971501234567',
          body: 'Hi',
          template: 'recall_message',
        }),
      ),
    ));
    render(<WhatsAppSendButton organizationId={4} kind="recall" subjectId={3} optedOut={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send via WhatsApp' }));
    const link = await screen.findByRole('link', { name: 'Open WhatsApp chat' });
    expect(link).toHaveAttribute('href', 'https://wa.me/971501234567?text=Hi');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
