import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { Lead, Paged } from '../../lib/types';
import { LEAD_SOURCES, LEAD_STATUSES, options } from '../../lib/constants';
import { formatDateTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

const PAGE_SIZE = 20;

interface LeadFilters {
  q: string;
  status: string;
  source: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: LeadFilters = { q: '', status: '', source: '', from: '', to: '' };

function statusTone(status: string): BadgeTone {
  if (status === 'NEW') return 'new';
  if (status === 'APPOINTMENT_BOOKED' || status === 'QUALIFIED') return 'success';
  if (status === 'LOST' || status === 'CLOSED') return 'danger';
  if (status === 'CONTACTED') return 'warn';
  return 'default';
}

export function LeadsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [draft, setDraft] = useState<LeadFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<LeadFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);

  const query = useMemo(() => {
    const parts: string[] = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.q !== '') parts.push(`q=${encodeURIComponent(applied.q)}`);
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    if (applied.source !== '') parts.push(`source=${applied.source}`);
    if (applied.from !== '') parts.push(`from=${applied.from}`);
    if (applied.to !== '') parts.push(`to=${applied.to}`);
    return parts.join('&');
  }, [applied, offset]);

  const path = orgId === null ? null : `/api/organizations/${orgId}/leads?${query}`;
  const { status, data, error, reload } = useApi<Paged & { leads: Lead[] }>(path);

  const { submit, saving, error: formError, clearFeedback, setError } = useSubmit();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    requestedService: '',
    source: 'WEBSITE',
  });
  const [flash, setFlash] = useState<string | null>(null);

  const createLead = async (): Promise<void> => {
    if (orgId === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/leads`, {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() === '' ? undefined : form.email.trim(),
          requestedService: form.requestedService.trim() === '' ? undefined : form.requestedService.trim(),
          source: form.source,
        },
      });
      return true;
    });
    if (ok !== null) {
      setForm({ firstName: '', lastName: '', phone: '', email: '', requestedService: '', source: 'WEBSITE' });
      setFlash('Lead added.');
      reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Website enquiries, missed-call leads and manual entries"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setAdding((value) => !value);
              clearFeedback();
              setFlash(null);
            }}
          >
            {adding ? 'Hide form' : 'Add lead'}
          </button>
        }
      />

      {adding ? (
        <section className="card">
          <h2 className="card-title">Add a lead</h2>
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
            <FormField label="Requested service">
              <input
                className="input"
                value={form.requestedService}
                onChange={(e) => {
                  setForm({ ...form, requestedService: e.target.value });
                  clearFeedback();
                }}
              />
            </FormField>
            <FormField label="Source">
              <select
                className="select"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              >
                {options(LEAD_SOURCES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
              onClick={() => void createLead()}
            >
              {saving ? 'Adding…' : 'Add lead'}
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
            <FormField label="Search">
              <input
                className="input"
                type="search"
                placeholder="Name, phone or email"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </FormField>
            <FormField label="Status">
              <select
                className="select"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">Any status</option>
                {options(LEAD_STATUSES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Source">
              <select
                className="select"
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
              >
                <option value="">Any source</option>
                {options(LEAD_SOURCES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Created from">
              <input
                className="input"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </FormField>
            <FormField label="Created to">
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
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">All leads</h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading leads…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Leads could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && data.leads.length === 0 ? (
          <EmptyState
            title="No leads found"
            description={
              applied.q || applied.status || applied.source || applied.from || applied.to
                ? 'No leads match the current filters. Try resetting them.'
                : 'New website enquiries and manually added leads will appear here.'
            }
          />
        ) : null}
        {data !== null && data.leads.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Leads table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Source</th>
                  <th scope="col">Requested service</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assigned to</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link to={`/leads/${lead.id}`}>{fullName(lead.firstName, lead.lastName)}</Link>
                    </td>
                    <td>{lead.phone}</td>
                    <td>{lead.source}</td>
                    <td>{lead.requestedService ?? '—'}</td>
                    <td>
                      <StatusBadge label={lead.status} tone={statusTone(lead.status)} />
                    </td>
                    <td>{lead.assignedUserEmail ?? '—'}</td>
                    <td>{formatDateTime(lead.createdAt)}</td>
                    <td>{formatDateTime(lead.lastActivityAt)}</td>
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
