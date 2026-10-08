import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { BusinessHours, Doctor } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingState, EmptyState, StatusBadge } from '../../components/states';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

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

interface DoctorForm {
  name: string;
  specialty: string;
  phone: string;
  email: string;
  slotMinutes: string;
  hours: Record<string, DayRow>;
}

function defaultHours(): Record<string, DayRow> {
  const hours: Record<string, DayRow> = {};
  for (const day of DAY_KEYS) {
    hours[day] =
      day === 'sat' || day === 'sun'
        ? { enabled: false, open: '09:00', close: '17:00' }
        : { enabled: true, open: '09:00', close: '17:00' };
  }
  return hours;
}

function hoursFromDoctor(doctor: Doctor): Record<string, DayRow> {
  const hours: Record<string, DayRow> = {};
  for (const day of DAY_KEYS) {
    const slot = doctor.workHours?.[day] ?? null;
    hours[day] = slot === null ? { enabled: false, open: '09:00', close: '17:00' } : { enabled: true, ...slot };
  }
  return hours;
}

function toBusinessHours(hours: Record<string, DayRow>): BusinessHours {
  const businessHours = {} as BusinessHours;
  for (const day of DAY_KEYS) {
    const row = hours[day];
    businessHours[day] = row !== undefined && row.enabled ? { open: row.open, close: row.close } : null;
  }
  return businessHours;
}

function emptyForm(): DoctorForm {
  return {
    name: '',
    specialty: '',
    phone: '',
    email: '',
    slotMinutes: '30',
    hours: defaultHours(),
  };
}

function formFromDoctor(doctor: Doctor): DoctorForm {
  return {
    name: doctor.name,
    specialty: doctor.specialty ?? '',
    phone: doctor.phone ?? '',
    email: doctor.email ?? '',
    slotMinutes: String(doctor.slotMinutes),
    hours: hoursFromDoctor(doctor),
  };
}

function validate(form: DoctorForm): string | null {
  if (form.name.trim().length === 0) return 'Doctor name cannot be empty.';
  const slotMinutes = Number(form.slotMinutes);
  if (!Number.isInteger(slotMinutes) || slotMinutes < 5 || slotMinutes > 480) {
    return 'Slot length must be a whole number of minutes between 5 and 480.';
  }
  for (const [day, row] of Object.entries(form.hours)) {
    if (row.enabled && row.open >= row.close) {
      return `${DAY_LABELS[day] ?? day}: opening time must be before closing time.`;
    }
  }
  return null;
}

function hoursSummary(doctor: Doctor): string {
  const parts: string[] = [];
  for (const day of DAY_KEYS) {
    const slot = doctor.workHours?.[day] ?? null;
    if (slot !== null) {
      parts.push(`${DAY_LABELS[day]?.slice(0, 3) ?? day} ${slot.open}–${slot.close}`);
    }
  }
  return parts.length === 0 ? 'No working hours set' : parts.join(', ');
}

export function DoctorsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const path = orgId === null ? null : `/api/organizations/${orgId}/doctors`;
  const { status, data, error, reload } = useApi<{ doctors: Doctor[] }>(path);
  const { submit, saving, error: formError, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DoctorForm | null>(null);
  const [confirmDoctor, setConfirmDoctor] = useState<Doctor | null>(null);

  const doctors = useMemo(() => data?.doctors ?? [], [data]);
  const form = draft;

  const openCreate = (): void => {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyForm());
    clearFeedback();
    setClientError(null);
    setFlash(null);
  };

  const openEdit = (doctor: Doctor): void => {
    setAdding(false);
    setEditingId(doctor.id);
    setDraft(formFromDoctor(doctor));
    clearFeedback();
    setClientError(null);
    setFlash(null);
  };

  const closeForm = (): void => {
    setAdding(false);
    setEditingId(null);
    setDraft(null);
    clearFeedback();
    setClientError(null);
  };

  const update = <K extends keyof DoctorForm>(key: K, value: DoctorForm[K]): void => {
    setDraft((prev) => (prev === null ? prev : { ...prev, [key]: value }));
    clearFeedback();
    setClientError(null);
  };

  const save = async (): Promise<void> => {
    if (orgId === null || form === null) return;
    const problem = validate(form);
    if (problem !== null) {
      setClientError(problem);
      return;
    }
    const body = {
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      slotMinutes: Number(form.slotMinutes),
      workHours: toBusinessHours(form.hours),
    };
    const ok = await submit(async () => {
      if (editingId !== null) {
        await apiFetch(`/api/organizations/${orgId}/doctors/${editingId}`, {
          method: 'PATCH',
          body,
        });
      } else {
        await apiFetch(`/api/organizations/${orgId}/doctors`, { method: 'POST', body });
      }
      return true;
    });
    if (ok !== null) {
      setFlash(editingId !== null ? 'Doctor updated.' : 'Doctor added.');
      closeForm();
      reload();
    }
  };

  const setisActive = async (doctor: Doctor, isActive: boolean): Promise<void> => {
    if (orgId === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/doctors/${doctor.id}`, {
        method: 'PATCH',
        body: { isActive },
      });
      return true;
    });
    setConfirmDoctor(null);
    if (ok !== null) {
      setFlash(isActive ? `${doctor.name} reactivated.` : `${doctor.name} deactivated.`);
      reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle="Doctors Panel — work hours and slot length drive every schedule and booking"
        actions={
          <button type="button" className="btn btn-primary" onClick={adding || editingId !== null ? closeForm : openCreate}>
            {adding || editingId !== null ? 'Hide form' : 'Add doctor'}
          </button>
        }
      />

      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}

      {adding || (editingId !== null && form !== null) ? (
        <section className="card">
          <h2 className="card-title">{editingId !== null ? 'Edit doctor' : 'Add a doctor'}</h2>
          {formError !== null || clientError !== null ? (
            <Flash
              kind="error"
              message={formError ?? clientError ?? ''}
              onDismiss={() => {
                clearFeedback();
                setClientError(null);
              }}
            />
          ) : null}
          {form !== null ? (
            <>
              <div className="form-grid">
                <FormField label="Name" required>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                  />
                </FormField>
                <FormField label="Specialty">
                  <input
                    className="input"
                    value={form.specialty}
                    onChange={(e) => update('specialty', e.target.value)}
                  />
                </FormField>
                <FormField label="Phone" hint="Optional">
                  <input
                    className="input"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                  />
                </FormField>
                <FormField label="Email" hint="Optional">
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                  />
                </FormField>
                <FormField label="Slot length (minutes)" hint="5–480, e.g. 30">
                  <input
                    className="input"
                    type="number"
                    min={5}
                    max={480}
                    value={form.slotMinutes}
                    onChange={(e) => update('slotMinutes', e.target.value)}
                  />
                </FormField>
              </div>

              <h2 className="card-title" style={{ marginTop: 'var(--space-3)' }}>
                Working hours
              </h2>
              {DAY_KEYS.map((day) => {
                const row = form.hours[day] ?? { enabled: false, open: '09:00', close: '17:00' };
                return (
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
                );
              })}

              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : editingId !== null ? 'Save changes' : 'Add doctor'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={saving}>
                  Cancel
                </button>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Panel of doctors</h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading doctors…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Doctors could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && doctors.length === 0 ? (
          <EmptyState
            title="No doctors yet"
            description="Add the first doctor to start generating slot suggestions for leads."
          />
        ) : null}
        {doctors.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Doctors table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Specialty</th>
                  <th scope="col">Working hours</th>
                  <th scope="col">Slot</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {doctors.map((doctor) => (
                  <tr key={doctor.id}>
                    <td>{doctor.name}</td>
                    <td>{doctor.specialty ?? '—'}</td>
                    <td style={{ fontSize: 'var(--fs-label)' }}>{hoursSummary(doctor)}</td>
                    <td>{doctor.slotMinutes} min</td>
                    <td>
                      <StatusBadge
                        label={doctor.isActive ? 'Active' : 'Inactive'}
                        tone={doctor.isActive ? 'success' : 'default'}
                      />
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-secondary" onClick={() => openEdit(doctor)}>
                        Edit
                      </button>{' '}
                      {doctor.isActive ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => setConfirmDoctor(doctor)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void setisActive(doctor, true)}
                        >
                          Reactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--fs-label)',
          }}
        >
          Deactivated doctors keep their history but stop receiving new bookings and slot
          suggestions. Existing appointments stay as they are.
        </p>
      </section>

      <ConfirmDialog
        open={confirmDoctor !== null}
        title="Deactivate doctor"
        body={
          confirmDoctor !== null
            ? `${confirmDoctor.name} will stop receiving new bookings and suggestions. Existing appointments stay as they are.`
            : ''
        }
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={() => {
          if (confirmDoctor !== null) void setisActive(confirmDoctor, false);
        }}
        onCancel={() => setConfirmDoctor(null)}
      />
    </div>
  );
}
