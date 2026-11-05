import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { qrMatrix, qrPath } from '../../lib/qrCode';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { useUnsavedChanges } from '../../lib/useUnsavedChanges';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState } from '../../components/states';

interface BookingSettings {
  enabled: boolean;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  autoConfirm: boolean;
  siteKey: string;
  path: string;
}

interface BookingResponse {
  booking: BookingSettings;
}

function BookingQr({ text }: { text: string }) {
  const drawn = useMemo(() => qrPath(qrMatrix(text), 4), [text]);
  return (
    <svg
      className="book-qr"
      viewBox={`0 0 ${drawn.size} ${drawn.size}`}
      role="img"
      aria-label="QR code for the booking page"
    >
      <rect width={drawn.size} height={drawn.size} fill="#ffffff" />
      <path d={drawn.d} fill="#2c0438" />
    </svg>
  );
}

export function OnlineBookingSettingsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const path = orgId === null ? null : `/api/organizations/${orgId}/booking`;
  const state = useApi<BookingResponse>(path);
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const [draft, setDraft] = useState<BookingSettings | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const booking = state.data?.booking ?? null;
  const form = draft ?? booking;
  const dirty = draft !== null && booking !== null && JSON.stringify(draft) !== JSON.stringify(booking);
  useUnsavedChanges(dirty);

  const update = <K extends keyof BookingSettings>(key: K, value: BookingSettings[K]): void => {
    setDraft((prev) => {
      const base = prev ?? booking;
      return base === null ? base : { ...base, [key]: value };
    });
    clearFeedback();
    setClientError(null);
    setCopied(false);
  };

  const link = form === null ? '' : `${window.location.origin}${form.path}`;

  const onSave = async (): Promise<void> => {
    if (form === null || path === null) return;
    const slotMinutes = Number(form.slotMinutes);
    const bufferMinutes = Number(form.bufferMinutes);
    const minNoticeMinutes = Number(form.minNoticeMinutes);
    const maxDaysAhead = Number(form.maxDaysAhead);
    if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
      setClientError('Slot length must be a whole number of minutes from 5 to 240.');
      return;
    }
    if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 120) {
      setClientError('Buffer must be a whole number of minutes from 0 to 120.');
      return;
    }
    if (!Number.isInteger(minNoticeMinutes) || minNoticeMinutes < 0 || minNoticeMinutes > 10080) {
      setClientError('Minimum notice must be a whole number of minutes from 0 to 10080.');
      return;
    }
    if (!Number.isInteger(maxDaysAhead) || maxDaysAhead < 1 || maxDaysAhead > 365) {
      setClientError('Days ahead must be a whole number from 1 to 365.');
      return;
    }
    const savedBooking = await submit(() =>
      apiFetch<BookingResponse>(path, {
        method: 'PATCH',
        body: {
          enabled: form.enabled,
          slotMinutes,
          bufferMinutes,
          minNoticeMinutes,
          maxDaysAhead,
          autoConfirm: form.autoConfirm,
        },
      }),
    );
    if (savedBooking !== null) {
      setDraft(null);
      state.reload();
    }
  };

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
      setClientError('The link could not be copied. Select it and copy it yourself.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Online booking"
        subtitle="A public page where patients can request a visit"
      />
      {state.status === 'loading' ? <LoadingState label="Loading booking settings…" /> : null}
      {state.status === 'error' ? (
        <ErrorState message={state.error ?? 'Booking settings could not be loaded.'} onRetry={state.reload} />
      ) : null}
      {form !== null && state.status === 'success' ? (
        <div className="card">
          {saved ? <Flash kind="success" message="Online booking saved." onDismiss={clearFeedback} /> : null}
          {(error ?? clientError) !== null ? (
            <Flash
              kind="error"
              message={error ?? clientError ?? ''}
              onDismiss={() => {
                clearFeedback();
                setClientError(null);
              }}
            />
          ) : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update('enabled', event.target.checked)}
            />
            Accept online bookings
          </label>

          <div className="book-link-row">
            <FormField label="Public link">
              <input className="input" readOnly value={link} aria-label="Booking link" />
            </FormField>
            <button type="button" className="btn btn-secondary" onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <BookingQr text={link} />
          <p className="book-note">The code is drawn on this page. It does not use an outside service.</p>

          <div className="form-grid">
            <FormField label="Slot length (minutes)" hint="How long each visit is.">
              <input
                className="input"
                type="number"
                min={5}
                max={240}
                value={form.slotMinutes}
                onChange={(event) => update('slotMinutes', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Buffer (minutes)" hint="Empty time kept after each visit.">
              <input
                className="input"
                type="number"
                min={0}
                max={120}
                value={form.bufferMinutes}
                onChange={(event) => update('bufferMinutes', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Minimum notice (minutes)" hint="120 minutes is 2 hours.">
              <input
                className="input"
                type="number"
                min={0}
                max={10080}
                value={form.minNoticeMinutes}
                onChange={(event) => update('minNoticeMinutes', Number(event.target.value))}
              />
            </FormField>
            <FormField label="Days ahead" hint="How far into the future a patient can book. 60 is two months.">
              <input
                className="input"
                type="number"
                min={1}
                max={365}
                value={form.maxDaysAhead}
                onChange={(event) => update('maxDaysAhead', Number(event.target.value))}
              />
            </FormField>
          </div>

          <fieldset className="book-confirm-choice">
            <legend>After the patient books</legend>
            <label className="book-choice">
              <input
                type="radio"
                name="booking-confirm"
                checked={!form.autoConfirm}
                onChange={() => update('autoConfirm', false)}
              />
              Needs approval
            </label>
            <label className="book-choice">
              <input
                type="radio"
                name="booking-confirm"
                checked={form.autoConfirm}
                onChange={() => update('autoConfirm', true)}
              />
              Confirm automatically
            </label>
          </fieldset>

          <p>
            Open times use the clinic hours on <Link to="/settings/clinic">Clinic profile</Link> and each
            doctor&apos;s working hours on <Link to="/doctors">Doctors</Link>. A new booking appears in the
            workspace as a new lead from online booking.
          </p>

          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={saving || !dirty} onClick={() => void onSave()}>
              {saving ? 'Saving…' : 'Save booking settings'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
