import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { Paged, Patient } from '../../lib/types';
import { formatDateTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState, EmptyState, StatusBadge } from '../../components/states';

const PAGE_SIZE = 20;

interface PatientForm {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

function prefillFrom(params: URLSearchParams): PatientForm {
  return {
    firstName: params.get('firstName') ?? '',
    lastName: params.get('lastName') ?? '',
    phone: params.get('phone') ?? '',
    email: params.get('email') ?? '',
  };
}

function hasPrefill(form: PatientForm): boolean {
  return (
    form.firstName !== '' || form.lastName !== '' || form.phone !== '' || form.email !== ''
  );
}

export function PatientsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const canCreate = can(user, 'patients.create');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [searchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const [syncedKey, setSyncedKey] = useState(paramsKey);
  const [adding, setAdding] = useState(() => searchParams.get('new') === '1');

  const path = useMemo(() => {
    if (orgId === null) return null;
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (query !== '') parts.push(`q=${encodeURIComponent(query)}`);
    return `/api/organizations/${orgId}/patients?${parts.join('&')}`;
  }, [orgId, query, offset]);

  const { status, data, error, reload } = useApi<Paged & { patients: Patient[] }>(path);
  const { submit, saving, error: formError, clearFeedback, setError } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);
  const [form, setForm] = useState<PatientForm>(() => prefillFrom(searchParams));

  if (syncedKey !== paramsKey) {
    setSyncedKey(paramsKey);
    if (searchParams.get('new') === '1') {
      setAdding(true);
    }
    const next = prefillFrom(searchParams);
    if (hasPrefill(next)) {
      setForm(next);
    }
  }

  const createPatient = async (): Promise<void> => {
    if (orgId === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/patients`, {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() === '' ? undefined : form.email.trim(),
        },
      });
      return true;
    });
    if (ok !== null) {
      setForm({ firstName: '', lastName: '', phone: '', email: '' });
      const leadId = searchParams.get('leadId');
      setFlash(
        leadId !== null && leadId !== ''
          ? 'Patient added. Open the lead to book the appointment.'
          : 'Patient added.',
      );
      reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Everyone who has contacted the clinic"
        actions={
          canCreate ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setAdding((value) => !value);
                clearFeedback();
                setFlash(null);
              }}
            >
              {adding ? 'Hide form' : 'Add patient'}
            </button>
          ) : null
        }
      />

      {adding && canCreate ? (
        <section className="card">
          <h2 className="card-title">Add a patient</h2>
          {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
          {formError ? <Flash kind="error" message={formError} onDismiss={clearFeedback} /> : null}
          <div className="form-grid">
            <FormField label="First name" required>
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => {
                  setForm({ ...form, firstName: e.target.value });
                  clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Last name" required>
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => {
                  setForm({ ...form, lastName: e.target.value });
                  clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Phone" required hint="Include country code, e.g. +973…">
              <input
                className="input"
                type="tel"
                value={form.phone}
                onChange={(e) => {
                  setForm({ ...form, phone: e.target.value });
                  clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Email">
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  clearFeedback();
                }}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                saving ||
                form.firstName.trim() === '' ||
                form.lastName.trim() === '' ||
                form.phone.trim() === ''
              }
              onClick={() => void createPatient()}
            >
              {saving ? 'Adding…' : 'Add patient'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Search</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(draft.trim());
            setOffset(0);
            setError(null);
          }}
        >
          <div className="form-grid">
            <FormField label="Name or phone">
              <input
                className="input"
                type="search"
                placeholder="e.g. Sara or +973…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary">
              Search
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDraft('');
                setQuery('');
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">All patients</h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading patients…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Patients could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && data.patients.length === 0 ? (
          <EmptyState
            title="No patients found"
            description={
              query !== ''
                ? 'No patients match this search. Try a different name or phone number.'
                : 'Patients appear here once leads convert or staff add them.'
            }
          />
        ) : null}
        {data !== null && data.patients.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Patients table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Email</th>
                  <th scope="col">SMS</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {data.patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <Link to={`/patients/${patient.id}`}>{fullName(patient.firstName, patient.lastName)}</Link>
                    </td>
                    <td>{patient.phone}</td>
                    <td>{patient.email ?? '—'}</td>
                    <td>
                      <StatusBadge
                        label={patient.smsOptOut ? 'Opted out' : 'Allowed'}
                        tone={patient.smsOptOut ? 'danger' : 'success'}
                      />
                    </td>
                    <td>{formatDateTime(patient.createdAt)}</td>
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
