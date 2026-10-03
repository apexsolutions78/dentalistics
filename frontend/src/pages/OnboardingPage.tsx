import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { apiFetch, errorMessage } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { FormField } from '../components/FormField';
import { Flash } from '../components/Flash';
import type { BusinessHours, Settings } from '../lib/types';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const DAYS: Array<{ key: string; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const STEP_LABELS = ['Clinic profile', 'Business hours', 'Review and finish'] as const;

interface HourRow {
  enabled: boolean;
  open: string;
  close: string;
}

type HourRows = Record<string, HourRow>;

function defaultHours(): HourRows {
  const rows: HourRows = {};
  for (const day of DAYS) {
    const weekday = day.key !== 'sat' && day.key !== 'sun';
    rows[day.key] = { enabled: weekday, open: '09:00', close: '17:00' };
  }
  return rows;
}

function hoursFromSettings(businessHours: BusinessHours | null): HourRows {
  const rows = defaultHours();
  if (businessHours === null) return rows;
  for (const day of DAYS) {
    const slot = businessHours[day.key] ?? null;
    if (slot === null) {
      rows[day.key] = { enabled: false, open: '09:00', close: '17:00' };
    } else {
      rows[day.key] = { enabled: true, open: slot.open, close: slot.close };
    }
  }
  return rows;
}

function hourRow(hours: HourRows, key: string): HourRow {
  return hours[key] ?? { enabled: false, open: '09:00', close: '17:00' };
}

export function OnboardingPage() {
  const { status, user, organization, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(organization?.name ?? '');
  const [phone, setPhone] = useState('');
  const [clinicEmail, setClinicEmail] = useState('');
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState<HourRows>(defaultHours);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});
  const [finished, setFinished] = useState(false);
  useDocumentTitle('Set up your clinic');

  const orgId = organization?.id ?? null;

  useEffect(() => {
    if (orgId === null || status !== 'authenticated') return;
    let cancelled = false;
    apiFetch<{ settings: Settings }>(`/api/organizations/${orgId}/settings`)
      .then((res) => {
        if (cancelled) return;
        const clinic = res.settings.clinic;
        setName(clinic.name);
        setPhone(clinic.phone ?? '');
        setClinicEmail(clinic.email ?? '');
        setAddress(clinic.address ?? '');
        setHours(hoursFromSettings(clinic.businessHours));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId, status]);

  if (status === 'loading') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="sub">Loading…</div>
        </div>
      </div>
    );
  }
  if (user === null) {
    return <Navigate to="/login" replace />;
  }
  if (user.organizationId === null || organization === null || orgId === null) {
    return <Navigate to="/" replace />;
  }
  if (organization.onboardingCompletedAt !== null && !finished) {
    return <Navigate to="/" replace />;
  }

  function validateProfile(): boolean {
    const next: Record<string, string | null> = {
      name: name.trim().length < 1 ? 'Enter your clinic name.' : null,
      email:
        clinicEmail.trim() !== '' && !EMAIL_PATTERN.test(clinicEmail.trim())
          ? 'Enter a valid email address.'
          : null,
      phone:
        phone.trim() !== '' && (phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)
          ? 'Phone must be 7-15 digits.'
          : null,
    };
    setFieldErrors(next);
    return Object.values(next).every((v) => v === null);
  }

  function validateHours(): boolean {
    for (const day of DAYS) {
      const row = hourRow(hours, day.key);
      if (row.enabled && row.open >= row.close) {
        setFieldErrors({ hours: `${day.label}: opening time must be before closing time.` });
        return false;
      }
    }
    setFieldErrors({});
    return true;
  }

  async function patchClinic(body: Record<string, unknown>): Promise<void> {
    await apiFetch(`/api/organizations/${orgId}/settings/clinic`, {
      method: 'PATCH',
      body,
    });
  }

  function buildBusinessHours(): BusinessHours {
    const businessHours: BusinessHours = {};
    for (const day of DAYS) {
      const row = hourRow(hours, day.key);
      businessHours[day.key] = row.enabled ? { open: row.open, close: row.close } : null;
    }
    return businessHours;
  }

  const onContinue = async (): Promise<void> => {
    if (busy) return;
    if (step === 1) {
      if (!validateProfile()) return;
      setBusy(true);
      setError(null);
      try {
        await patchClinic({
          name: name.trim(),
          phone: phone.trim(),
          email: clinicEmail.trim(),
          address: address.trim(),
        });
        setStep(2);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 2) {
      if (!validateHours()) return;
      setBusy(true);
      setError(null);
      try {
        await patchClinic({ businessHours: buildBusinessHours() });
        setStep(3);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/organizations/${orgId}/onboarding/complete`, { method: 'POST' });
      setFinished(true);
      await refreshSession();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const enabledDays = DAYS.filter((day) => hourRow(hours, day.key).enabled);

  return (
    <div className="login-page">
      <div className="login-card onboarding-card">
        <h1>Set up your clinic</h1>
        <div className="sub">
          Step {step} of 3 - {STEP_LABELS[step - 1]}
        </div>
        {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}

        {step === 1 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onContinue();
            }}
            noValidate
          >
            <FormField label="Clinic name" htmlFor="onb-name" error={fieldErrors.name}>
              <input
                className="input"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, name: null }));
                }}
                required
              />
            </FormField>
            <FormField label="Clinic phone (optional)" htmlFor="onb-phone" error={fieldErrors.phone}>
              <input
                className="input"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, phone: null }));
                }}
              />
            </FormField>
            <FormField label="Contact email (optional)" htmlFor="onb-email" error={fieldErrors.email}>
              <input
                className="input"
                type="email"
                value={clinicEmail}
                onChange={(e) => {
                  setClinicEmail(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, email: null }));
                }}
              />
            </FormField>
            <FormField label="Address (optional)" htmlFor="onb-address" error={fieldErrors.address}>
              <input
                className="input"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </FormField>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onContinue();
            }}
            noValidate
          >
            <p className="sub">When is your clinic open? Adjust the defaults if needed.</p>
            {fieldErrors.hours ? (
              <Flash kind="error" message={fieldErrors.hours} onDismiss={() => setFieldErrors({})} />
            ) : null}
            {DAYS.map((day) => {
              const row = hourRow(hours, day.key);
              return (
                <div className="hours-row" key={day.key}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        setHours((prev) => ({
                          ...prev,
                          [day.key]: { ...hourRow(prev, day.key), enabled: e.target.checked },
                        }))
                      }
                    />
                    {day.label}
                  </label>
                  <div className="hours-times">
                    <input
                      className="input"
                      type="time"
                      aria-label={`${day.label} opening time`}
                      value={row.open}
                      disabled={!row.enabled}
                      onChange={(e) =>
                        setHours((prev) => ({
                          ...prev,
                          [day.key]: { ...hourRow(prev, day.key), open: e.target.value },
                        }))
                      }
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      className="input"
                      type="time"
                      aria-label={`${day.label} closing time`}
                      value={row.close}
                      disabled={!row.enabled}
                      onChange={(e) =>
                        setHours((prev) => ({
                          ...prev,
                          [day.key]: { ...hourRow(prev, day.key), close: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
            <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <div>
            <p className="sub">Review your clinic details. You can change everything later in Settings.</p>
            <dl className="onboarding-review">
              <dt>Clinic name</dt>
              <dd>{name.trim()}</dd>
              <dt>Phone</dt>
              <dd>{phone.trim() !== '' ? phone.trim() : 'Not set'}</dd>
              <dt>Contact email</dt>
              <dd>{clinicEmail.trim() !== '' ? clinicEmail.trim() : 'Not set'}</dd>
              <dt>Address</dt>
              <dd>{address.trim() !== '' ? address.trim() : 'Not set'}</dd>
              <dt>Open days</dt>
              <dd>
                {enabledDays.length > 0
                  ? `${enabledDays.length} days per week`
                  : 'Closed all week'}
              </dd>
            </dl>
            {error ? <Flash kind="error" message={error} onDismiss={() => setError(null)} /> : null}
            <div className="btn-row" style={{ marginTop: 'var(--space-4)' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(2)}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onContinue()}
                disabled={busy}
              >
                {busy ? 'Finishing…' : 'Finish setup'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
