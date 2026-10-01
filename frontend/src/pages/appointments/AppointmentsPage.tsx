import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { Appointment, Paged, Patient } from '../../lib/types';
import { APPOINTMENT_STATUSES, options } from '../../lib/constants';
import { formatDate, formatTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

const PAGE_SIZE = 20;

export function statusTone(status: string): BadgeTone {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'NO_SHOW' || status === 'CANCELLED') return 'danger';
  if (status === 'SCHEDULED') return 'warn';
  if (status === 'RESCHEDULED') return 'default';
  return 'default';
}

interface AppointmentFilters {
  status: string;
  from: string;
  to: string;
  patientId: string;
}

const EMPTY: AppointmentFilters = { status: '', from: '', to: '', patientId: '' };

export function AppointmentsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [searchParams, setSearchParams] = useSearchParams();

  const [draft, setDraft] = useState<AppointmentFilters>({
    status: searchParams.get('status') ?? '',
    from: '',
    to: '',
    patientId: searchParams.get('patientId') ?? '',
  });
  const [applied, setApplied] = useState<AppointmentFilters>(draft);
  const [offset, setOffset] = useState(0);
  const showForm = searchParams.get('new') === '1';
  const prefillPhone = searchParams.get('phone') ?? '';
  const prefillLeadId = searchParams.get('leadId') ?? '';

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    if (applied.from !== '') parts.push(`from=${applied.from}`);
    if (applied.to !== '') parts.push(`to=${applied.to}`);
    if (applied.patientId !== '') parts.push(`patientId=${applied.patientId}`);
    return parts.join('&');
  }, [applied, offset]);

  const path = orgId === null ? null : `/api/organizations/${orgId}/appointments?${query}`;
  const { status, data, error, reload } = useApi<Paged & { appointments: Appointment[] }>(path);

  const { submit, saving, error: formError, clearFeedback, setError } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);

  const [pickerQuery, setPickerQuery] = useState(prefillPhone);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [pickerSearch, setPickerSearch] = useState(prefillPhone);
  const [form, setForm] = useState({ date: '', time: '', service: '', provider: '' });

  const paramsKey = searchParams.toString();
  const [syncedKey, setSyncedKey] = useState(paramsKey);
  if (syncedKey !== paramsKey) {
    setSyncedKey(paramsKey);
    const next: AppointmentFilters = {
      status: searchParams.get('status') ?? '',
      from: '',
      to: '',
      patientId: searchParams.get('patientId') ?? '',
    };
    setDraft(next);
    setApplied(next);
    setOffset(0);
    const phone = searchParams.get('phone') ?? '';
    setPickerQuery(phone);
    setPickerSearch(phone);
  }

  const pickerPath =
    orgId === null || pickerSearch.trim() === ''
      ? null
      : `/api/organizations/${orgId}/patients?q=${encodeURIComponent(pickerSearch.trim())}&limit=10`;
  const picker = useApi<Paged & { patients: Patient[] }>(pickerPath);

  const createAppointment = async (): Promise<void> => {
    if (orgId === null || selectedPatient === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      const body: Record<string, unknown> = {
        patientId: selectedPatient.id,
        date: form.date,
        time: form.time,
      };
      if (form.service.trim() !== '') body.service = form.service.trim();
      if (form.provider.trim() !== '') body.provider = form.provider.trim();
      if (prefillLeadId !== '') body.leadId = Number(prefillLeadId);
      await apiFetch(`/api/organizations/${orgId}/appointments`, { method: 'POST', body });
      return true;
    });
    if (ok !== null) {
      setFlash('Appointment booked.');
      setForm({ date: '', time: '', service: '', provider: '' });
      setSelectedPatient(null);
      setPickerQuery('');
      setPickerSearch('');
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      next.delete('leadId');
      next.delete('phone');
      setSearchParams(next, { replace: true });
      reload();
    }
  };

  const patients = data?.appointments ?? [];
  const filtered = applied.status !== '' || applied.from !== '' || applied.to !== '' || applied.patientId !== '';

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Schedule, confirmations, no-shows and rebooking"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (showForm) {
                next.delete('new');
                next.delete('leadId');
                next.delete('phone');
              } else {
                next.set('new', '1');
              }
              setSearchParams(next);
              clearFeedback();
              setFlash(null);
            }}
          >
            {showForm ? 'Hide form' : 'Book appointment'}
          </button>
        }
      />

      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}

      {showForm ? (
        <section className="card">
          <h2 className="card-title">Book an appointment</h2>
          {formError ? <Flash kind="error" message={formError} onDismiss={clearFeedback} /> : null}
          <div className="form-grid">
            <FormField label="Find patient" hint="Search by name or phone, then pick a result.">
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  className="input"
                  type="search"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Name or phone"
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPickerSearch(pickerQuery.trim())}
                >
                  Search
                </button>
              </div>
            </FormField>
            <FormField label="Patient" required>
              {selectedPatient !== null ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>
                    {fullName(selectedPatient.firstName, selectedPatient.lastName)} ({selectedPatient.phone})
                  </span>
                  <button type="button" className="btn btn-secondary" onClick={() => setSelectedPatient(null)}>
                    Change
                  </button>
                </div>
              ) : picker.status === 'loading' && picker.data === null ? (
                <LoadingState label="Searching…" />
              ) : picker.data !== null && picker.data.patients.length > 0 ? (
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    const found = picker.data?.patients.find((p) => String(p.id) === e.target.value);
                    if (found !== undefined) setSelectedPatient(found);
                  }}
                >
                  <option value="">Choose a patient…</option>
                  {picker.data.patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {fullName(patient.firstName, patient.lastName)} — {patient.phone}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                  {picker.data === null
                    ? 'Enter a name or phone to search.'
                    : 'No patients match. Add the patient first.'}{' '}
                  <Link to="/patients">Open patients</Link>
                </span>
              )}
            </FormField>
            <FormField label="Date" required>
              <input
                className="input"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </FormField>
            <FormField label="Time" required>
              <input
                className="input"
                type="time"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </FormField>
            <FormField label="Service">
              <input
                className="input"
                value={form.service}
                onChange={(e) => setForm({ ...form, service: e.target.value })}
              />
            </FormField>
            <FormField label="Provider">
              <input
                className="input"
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              />
            </FormField>
          </div>
          {prefillLeadId !== '' ? (
            <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
              This appointment will be linked to the lead you came from.
            </p>
          ) : null}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                saving ||
                selectedPatient === null ||
                form.date === '' ||
                form.time === ''
              }
              onClick={() => void createAppointment()}
            >
              {saving ? 'Booking…' : 'Book appointment'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Filters</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(draft);
            setOffset(0);
            setError(null);
          }}
        >
          <div className="form-grid">
            <FormField label="Status">
              <select
                className="select"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">Any status</option>
                {options(APPOINTMENT_STATUSES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Date from">
              <input
                className="input"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </FormField>
            <FormField label="Date to">
              <input
                className="input"
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary">
              Apply filters
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDraft(EMPTY);
                setApplied(EMPTY);
                setOffset(0);
                const next = new URLSearchParams(searchParams);
                next.delete('status');
                next.delete('patientId');
                setSearchParams(next, { replace: true });
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">
          Appointments{applied.patientId !== '' ? ' (filtered by patient)' : ''}
        </h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading appointments…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Appointments could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && patients.length === 0 ? (
          <EmptyState
            title="No appointments found"
            description={
              filtered
                ? 'No appointments match the current filters. Try resetting them.'
                : 'Book the first appointment to see it here.'
            }
          />
        ) : null}
        {data !== null && patients.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Appointments table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Provider</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {patients.map((appt) => (
                  <tr key={appt.id}>
                    <td>{formatDate(appt.date)}</td>
                    <td>{formatTime(appt.time)}</td>
                    <td>
                      <Link to={`/patients/${appt.patientId}`}>
                        {fullName(appt.patient.firstName, appt.patient.lastName)}
                      </Link>
                    </td>
                    <td>{appt.service ?? '—'}</td>
                    <td>
                      <StatusBadge label={appt.status} tone={statusTone(appt.status)} />
                    </td>
                    <td>{appt.provider ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-secondary" to={`/appointments/${appt.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data !== null ? (
          <Pager total={data.total} limit={data.limit} offset={data.offset} onOffset={setOffset} />
        ) : null}
      </section>
    </div>
  );
}
