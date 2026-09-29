import { useState } from 'react';
import { useSettings } from '../../lib/settings';
import { useSubmit } from '../../lib/useAsync';
import type { BusinessHours, Settings } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { SettingsBody } from './SettingsBody';

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

interface DayRow {
  enabled: boolean;
  open: string;
  close: string;
}

interface ClinicForm {
  name: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string;
  timezone: string;
  hours: Record<string, DayRow>;
}

function toForm(settings: Settings): ClinicForm {
  const days = settings.definitions.businessHourDays;
  const hours: Record<string, DayRow> = {};
  for (const day of days) {
    const slot = settings.clinic.businessHours?.[day] ?? null;
    hours[day] = slot === null ? { enabled: false, open: '09:00', close: '17:00' } : { enabled: true, ...slot };
  }
  return {
    name: settings.clinic.name ?? '',
    phone: settings.clinic.phone ?? '',
    email: settings.clinic.email ?? '',
    address: settings.clinic.address ?? '',
    logoUrl: settings.clinic.logoUrl ?? '',
    timezone: settings.clinic.timezone ?? '',
    hours,
  };
}

function validate(form: ClinicForm): string | null {
  if (form.name.trim().length === 0) {
    return 'Clinic name cannot be empty.';
  }
  for (const [day, row] of Object.entries(form.hours)) {
    if (row.enabled && row.open >= row.close) {
      return `${DAY_LABELS[day] ?? day}: opening time must be before closing time.`;
    }
  }
  if (form.timezone.trim().length === 0) {
    return 'Timezone cannot be empty.';
  }
  return null;
}

export function ClinicSettingsPage() {
  const { state, reload, patchClinic } = useSettings();
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const [draft, setDraft] = useState<ClinicForm | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const settings = state.settings;
  const form = draft ?? (settings !== null ? toForm(settings) : null);

  const update = <K extends keyof ClinicForm>(key: K, value: ClinicForm[K]): void => {
    setDraft((prev) => {
      const base = prev ?? (settings !== null ? toForm(settings) : null);
      return base === null ? base : { ...base, [key]: value };
    });
    clearFeedback();
    setClientError(null);
  };

  const onSave = async (): Promise<void> => {
    if (form === null) return;
    const problem = validate(form);
    if (problem !== null) {
      setClientError(problem);
      return;
    }
    const businessHours: BusinessHours = {} as BusinessHours;
    for (const [day, row] of Object.entries(form.hours)) {
      businessHours[day] = row.enabled ? { open: row.open, close: row.close } : null;
    }
    await submit(() =>
      patchClinic({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        logoUrl: form.logoUrl.trim(),
        timezone: form.timezone.trim(),
        businessHours,
      }),
    );
  };

  return (
    <div>
      <PageHeader title="Clinic profile" subtitle="How your clinic appears to staff and patients" />
      <SettingsBody state={state} onRetry={reload}>
        {() => {
          if (form === null) return null;
          return (
            <div className="card">
              {saved ? <Flash kind="success" message="Clinic profile saved." onDismiss={clearFeedback} /> : null}
              {(error ?? clientError) !== null ? (
                <Flash kind="error" message={error ?? clientError ?? ''} onDismiss={() => { clearFeedback(); setClientError(null); }} />
              ) : null}

              <div className="form-grid">
                <FormField label="Clinic name">
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                  />
                </FormField>
                <FormField label="Phone" hint="Digits only, optional leading +">
                  <input
                    className="input"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                  />
                </FormField>
                <FormField label="Email">
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                </FormField>
                <FormField label="Timezone" hint="IANA name, e.g. Asia/Bahrain">
                  <input
                    className="input"
                    value={form.timezone}
                    onChange={(e) => update('timezone', e.target.value)}
                  />
                </FormField>
                <FormField label="Address">
                  <input
                    className="input"
                    value={form.address}
                    onChange={(e) => update('address', e.target.value)}
                  />
                </FormField>
                <FormField label="Logo URL">
                  <input
                    className="input"
                    value={form.logoUrl}
                    onChange={(e) => update('logoUrl', e.target.value)}
                  />
                </FormField>
              </div>

              <div className="card-title" style={{ marginTop: 'var(--space-3)' }}>
                Business hours
              </div>
              {Object.entries(form.hours).map(([day, row]) => (
                <div className="hours-row" key={day}>
                  <label className="checkbox-row" style={{ marginBottom: 0 }}>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        update('hours', {
                          ...form.hours,
                          [day]: { ...row, enabled: e.target.checked },
                        })
                      }
                    />
                    {DAY_LABELS[day] ?? day}
                  </label>
                  <span />
                  <div className="hours-times">
                    <input
                      className="input"
                      type="time"
                      value={row.open}
                      disabled={!row.enabled}
                      aria-label={`${DAY_LABELS[day] ?? day} opening time`}
                      onChange={(e) =>
                        update('hours', { ...form.hours, [day]: { ...row, open: e.target.value } })
                      }
                    />
                    <span>to</span>
                    <input
                      className="input"
                      type="time"
                      value={row.close}
                      disabled={!row.enabled}
                      aria-label={`${DAY_LABELS[day] ?? day} closing time`}
                      onChange={(e) =>
                        update('hours', { ...form.hours, [day]: { ...row, close: e.target.value } })
                      }
                    />
                  </div>
                </div>
              ))}

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onSave()}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          );
        }}
      </SettingsBody>
    </div>
  );
}
