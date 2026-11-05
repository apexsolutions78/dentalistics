import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../../lib/api';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';

interface PublicDoctor {
  id: number;
  name: string;
  specialty: string | null;
}

interface PublicBooking {
  available: boolean;
  message?: string;
  clinic?: {
    name: string;
    phone: string | null;
    address: string | null;
    logoUrl: string | null;
    timezone: string;
  };
  booking?: {
    slotMinutes: number;
    minNoticeMinutes: number;
    maxDaysAhead: number;
    confirmation: 'pending' | 'confirmed';
  };
  doctors?: PublicDoctor[];
  today?: string;
  lastDate?: string;
}

interface SlotResponse {
  slots: string[];
}

interface BookingResult {
  accepted: boolean;
  confirmation: 'pending' | 'confirmed';
  date?: string;
  time?: string;
  doctorName?: string;
  clinicName?: string;
  emailSent: boolean;
  appointmentId?: number;
}

const STEPS = ['Visit', 'Time', 'Details', 'Confirm'] as const;

function formatWhen(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const stamp = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const label = stamp.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${label} at ${time}`;
}

export function BookingPage() {
  const { siteKey = '' } = useParams();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const stepMounted = useRef(false);
  const doctorGroup = useId();
  const [view, setView] = useState<PublicBooking | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState('');
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const clinicName = view?.clinic?.name ?? 'Clinic';
  useDocumentTitle(view === null ? 'Book a visit' : `Book at ${clinicName}`);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PublicBooking>(`/api/public/booking/${siteKey}`)
      .then((body) => {
        if (cancelled) return;
        setView(body);
        if (body.today) {
          setDate(body.today);
          setSlotsLoading(body.available === true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'This booking page could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    stepRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (result !== null) headingRef.current?.focus();
  }, [result]);

  useEffect(() => {
    if (view?.available !== true || date === '') return;
    let cancelled = false;
    const doctorQuery = doctorId === null ? '' : `&doctorId=${doctorId}`;
    apiFetch<SlotResponse>(`/api/public/booking/${siteKey}/slots?date=${date}${doctorQuery}`)
      .then((body) => {
        if (cancelled) return;
        setSlots(body.slots);
        setTime((current) => (body.slots.includes(current) ? current : ''));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSlots([]);
          setSlotsError(err instanceof Error ? err.message : 'Open times could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view?.available, date, doctorId, siteKey]);

  const go = (next: number): void => {
    setFormError(null);
    setStep(next);
  };

  const submit = async (): Promise<void> => {
    setSaving(true);
    setFormError(null);
    try {
      const booked = await apiFetch<BookingResult>(`/api/public/booking/${siteKey}`, {
        method: 'POST',
        body: {
          name,
          phone,
          email,
          reason,
          notes,
          doctorId,
          date,
          time,
          consent,
          companyWebsite,
        },
      });
      if (booked.appointmentId === undefined) {
        setFormError('That request could not be saved. Please try again.');
        return;
      }
      setResult(booked);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setFormError('That time was just taken. Choose another.');
        setStep(1);
        return;
      }
      setFormError(err instanceof Error ? err.message : 'The booking could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loadError !== null) {
    return (
      <main className="book-page">
        <ErrorState message={loadError} />
      </main>
    );
  }
  if (view === null) {
    return (
      <main className="book-page">
        <LoadingState label="Loading the clinic…" />
      </main>
    );
  }
  if (!view.available || view.booking === undefined || view.clinic === undefined) {
    return (
      <main className="book-page">
        <p className="book-kicker">Online booking</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {view.clinic?.name ?? 'Online booking'}
        </h1>
        <p className="book-unavailable" role="status">
          Online booking is not available.
        </p>
      </main>
    );
  }

  const clinic = view.clinic;
  const booking = view.booking;
  const doctors = view.doctors ?? [];
  const doctorName =
    doctorId === null ? 'Any doctor' : (doctors.find((doctor) => doctor.id === doctorId)?.name ?? 'Doctor');
  const initial = clinic.name.trim().charAt(0).toUpperCase() || 'C';

  if (result !== null) {
    const confirmed = result.confirmation === 'confirmed';
    return (
      <main className="book-page">
        <p className="book-kicker">{result.clinicName ?? clinic.name}</p>
        <h1 ref={headingRef} tabIndex={-1}>
          {confirmed ? 'Your visit is confirmed' : 'Request received'}
        </h1>
        <p className="book-lead" role="status">
          {confirmed
            ? 'The clinic has this time held for you.'
            : 'The clinic will confirm this request.'}
        </p>
        <dl className="book-summary">
          <div>
            <dt>When</dt>
            <dd>{result.date && result.time ? formatWhen(result.date, result.time) : ''}</dd>
          </div>
          <div>
            <dt>Doctor</dt>
            <dd>{result.doctorName}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{reason}</dd>
          </div>
        </dl>
        {result.emailSent ? <p>A confirmation email is on its way.</p> : null}
        {result.appointmentId !== undefined ? (
          <p className="book-ref">Reference {result.appointmentId}</p>
        ) : null}
      </main>
    );
  }

  return (
    <main className="book-page">
      <header className="book-clinic">
        {clinic.logoUrl && !logoFailed ? (
          <img
            className="book-logo"
            src={clinic.logoUrl}
            alt=""
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span className="book-mark" aria-hidden="true">
            {initial}
          </span>
        )}
        <div>
          <p className="book-kicker">Book a visit</p>
          <h1 ref={headingRef} tabIndex={-1}>
            {clinic.name}
          </h1>
          {clinic.address ? <p>{clinic.address}</p> : null}
          {clinic.phone ? <p>{clinic.phone}</p> : null}
        </div>
      </header>

      <ol className="book-progress" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {formError !== null ? (
        <p className="book-error" role="alert">
          {formError}
        </p>
      ) : null}

      {step === 0 ? (
        <section>
          <h2 ref={stepRef} tabIndex={-1}>What do you need?</h2>
          <FormField label="Reason for visit" hint="For example, cleaning or a toothache." required>
            <input
              className="input"
              value={reason}
              maxLength={120}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <div className="book-actions">
            <button
              type="button"
              className="btn book-primary"
              disabled={reason.trim() === ''}
              onClick={() => go(1)}
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h2 ref={stepRef} tabIndex={-1}>Choose a time</h2>
          <fieldset className="book-doctors">
            <legend>Doctor</legend>
            <label className="book-choice">
              <input
                type="radio"
                name={doctorGroup}
                checked={doctorId === null}
                onChange={() => {
                  setDoctorId(null);
                  setSlotsLoading(true);
                  setSlotsError(null);
                }}
              />
              Any doctor
            </label>
            {doctors.map((doctor) => (
              <label className="book-choice" key={doctor.id}>
                <input
                  type="radio"
                  name={doctorGroup}
                  checked={doctorId === doctor.id}
                  onChange={() => {
                    setDoctorId(doctor.id);
                    setSlotsLoading(true);
                    setSlotsError(null);
                  }}
                />
                <span>
                  {doctor.name}
                  {doctor.specialty ? <small>{doctor.specialty}</small> : null}
                </span>
              </label>
            ))}
          </fieldset>
          {doctors.length === 0 ? (
            <p role="status">This clinic has no doctor available for online booking.</p>
          ) : (
            <>
              <FormField label="Date" hint={`Times use ${clinic.timezone}.`}>
                <input
                  className="input"
                  type="date"
                  value={date}
                  min={view.today}
                  max={view.lastDate}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setSlotsLoading(true);
                    setSlotsError(null);
                  }}
                />
              </FormField>
              {slotsLoading ? <p role="status">Looking for open times…</p> : null}
              {slotsError !== null ? (
                <p className="book-error" role="alert">
                  {slotsError}
                </p>
              ) : null}
              {!slotsLoading && slotsError === null && slots.length === 0 ? (
                <p role="status">No open times on this day.</p>
              ) : null}
              <div className="book-slots" role="group" aria-label="Open times">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    className={slot === time ? 'book-slot is-selected' : 'book-slot'}
                    aria-pressed={slot === time}
                    onClick={() => setTime(slot)}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="book-actions">
            <button type="button" className="btn btn-secondary" onClick={() => go(0)}>
              Back
            </button>
            <button
              type="button"
              className="btn book-primary"
              disabled={time === '' || doctors.length === 0}
              onClick={() => go(2)}
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h2 ref={stepRef} tabIndex={-1}>Your details</h2>
          <div className="book-honeypot" aria-hidden="true">
            <label>
              Company website
              <input
                name="companyWebsite"
                tabIndex={-1}
                autoComplete="off"
                value={companyWebsite}
                onChange={(event) => setCompanyWebsite(event.target.value)}
              />
            </label>
          </div>
          <FormField label="Full name" required>
            <input
              className="input"
              autoComplete="name"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label="Phone" hint="Digits, with an optional leading +." required>
            <input
              className="input"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </FormField>
          <FormField label="Email" required>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField label="Notes">
            <textarea
              className="textarea"
              value={notes}
              maxLength={2000}
              rows={3}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
          <label className="book-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I agree that the clinic may contact me about this appointment.
          </label>
          <div className="book-actions">
            <button type="button" className="btn btn-secondary" onClick={() => go(1)}>
              Back
            </button>
            <button
              type="button"
              className="btn book-primary"
              disabled={name.trim() === '' || phone.trim() === '' || email.trim() === '' || !consent}
              onClick={() => go(3)}
            >
              Review
            </button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section>
          <h2 ref={stepRef} tabIndex={-1}>Confirm your visit</h2>
          <dl className="book-summary">
            <div>
              <dt>Reason</dt>
              <dd>{reason}</dd>
            </div>
            <div>
              <dt>When</dt>
              <dd>{formatWhen(date, time)}</dd>
            </div>
            <div>
              <dt>Doctor</dt>
              <dd>{doctorName}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{name}</dd>
            </div>
          </dl>
          <p>
            {booking.confirmation === 'confirmed'
              ? 'This clinic confirms online bookings straight away.'
              : 'This clinic reviews the request before the visit is confirmed.'}
          </p>
          <div className="book-actions">
            <button type="button" className="btn btn-secondary" onClick={() => go(2)} disabled={saving}>
              Back
            </button>
            <button type="button" className="btn book-primary" disabled={saving} onClick={() => void submit()}>
              {saving ? 'Booking…' : 'Confirm booking'}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
