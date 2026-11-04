import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useSubmit } from '../lib/useAsync';

interface WhatsAppHandoff {
  url: string | null;
  phoneE164: string;
  body: string;
  template: string;
}

export function WhatsAppSendButton({
  organizationId,
  kind,
  subjectId,
  optedOut,
}: {
  organizationId: number;
  kind: 'appointment' | 'recall';
  subjectId: number;
  optedOut: boolean;
}) {
  const { submit, saving, error, clearFeedback } = useSubmit();
  const [notice, setNotice] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const hintId = `wa-opt-out-${kind}-${subjectId}`;

  const send = async (): Promise<void> => {
    setNotice(null);
    setFallbackUrl(null);
    clearFeedback();
    const path =
      kind === 'appointment'
        ? `/api/organizations/${organizationId}/appointments/${subjectId}/whatsapp`
        : `/api/organizations/${organizationId}/recalls/${subjectId}/whatsapp`;
    const result = await submit(() => apiFetch<WhatsAppHandoff>(path, { method: 'POST', body: {} }));
    if (result === null) {
      return;
    }
    if (result.url === null) {
      setNotice('The message is logged as sent via WhatsApp.');
      return;
    }
    const opened = window.open(result.url, '_blank', 'noopener,noreferrer');
    if (opened === null) {
      setFallbackUrl(result.url);
      setNotice('The message is logged as sent. Open the WhatsApp chat with the link.');
      return;
    }
    setNotice('WhatsApp chat opened. The message is logged as sent.');
  };

  return (
    <span className="whatsapp-send">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={optedOut || saving}
        aria-describedby={optedOut ? hintId : undefined}
        onClick={() => void send()}
      >
        {saving ? 'Opening WhatsApp…' : 'Send via WhatsApp'}
      </button>
      {optedOut ? (
        <span id={hintId} className="whatsapp-send-note">
          This patient has opted out of messages.
        </span>
      ) : null}
      {notice !== null ? (
        <span className="whatsapp-send-note" role="status">
          {notice}
        </span>
      ) : null}
      {error !== null ? (
        <span className="whatsapp-send-note" role="alert">
          {error}
        </span>
      ) : null}
      {fallbackUrl !== null ? (
        <a className="whatsapp-send-note" href={fallbackUrl} target="_blank" rel="noopener noreferrer">
          Open WhatsApp chat
        </a>
      ) : null}
    </span>
  );
}
