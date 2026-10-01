import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { canManageSettings, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { LeadDetail } from '../../lib/types';
import { LEAD_STATUSES, options } from '../../lib/constants';
import { formatDate, formatDateTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { CommunicationTimeline } from '../../components/CommunicationTimeline';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

function statusTone(status: string): BadgeTone {
  if (status === 'NEW') return 'new';
  if (status === 'APPOINTMENT_BOOKED' || status === 'QUALIFIED') return 'success';
  if (status === 'LOST' || status === 'CLOSED') return 'danger';
  if (status === 'CONTACTED') return 'warn';
  return 'default';
}

export function LeadDetailPage() {
  const { leadId } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const path = orgId === null || leadId === undefined ? null : `/api/organizations/${orgId}/leads/${leadId}`;
  const { status, data, error, reload } = useApi<LeadDetail>(path);
  const { submit, saving, error: actionError, saved, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const canManage = canManageSettings(user);

  const saveStatus = async (): Promise<void> => {
    if (orgId === null || leadId === undefined || statusDraft === null || data === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/leads/${leadId}`, {
        method: 'PATCH',
        body: { status: statusDraft },
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Lead status updated.');
      setStatusDraft(null);
      reload();
    }
  };

  const saveNotes = async (): Promise<void> => {
    if (orgId === null || leadId === undefined || notesDraft === null || data === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/leads/${leadId}`, {
        method: 'PATCH',
        body: { notes: notesDraft },
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Notes saved.');
      setNotesDraft(null);
      reload();
    }
  };

  if (status === 'loading' && data === null) {
    return (
      <div>
        <PageHeader title="Lead" />
        <LoadingState label="Loading lead…" />
      </div>
    );
  }
  if (status === 'error' && data === null) {
    return (
      <div>
        <PageHeader title="Lead" />
        <ErrorState message={error ?? 'This lead could not be loaded.'} onRetry={reload} />
      </div>
    );
  }
  if (data === null) return null;

  const lead = data.lead;
  const effectiveStatus = statusDraft ?? lead.status;

  return (
    <div>
      <PageHeader
        title={fullName(lead.firstName, lead.lastName)}
        subtitle={`Lead from ${lead.source} · created ${formatDateTime(lead.createdAt)}`}
        actions={<Link className="btn btn-secondary" to="/leads">Back to leads</Link>}
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {actionError ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
      {saved && flash === null ? <Flash kind="success" message="Saved." onDismiss={clearFeedback} /> : null}

      <section className="card">
        <h2 className="card-title">
          Contact information <StatusBadge label={lead.status} tone={statusTone(lead.status)} />
        </h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Lead contact details">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Phone</th>
                <td>{lead.phone}</td>
              </tr>
              <tr>
                <th scope="row">Email</th>
                <td>{lead.email ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Requested service</th>
                <td>{lead.requestedService ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Assigned to</th>
                <td>{lead.assignedUserEmail ?? 'Unassigned'}</td>
              </tr>
              <tr>
                <th scope="row">Last activity</th>
                <td>{formatDateTime(lead.lastActivityAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Primary actions</h2>
        <div className="form-grid">
          <FormField label="Status">
            <select
              className="select"
              value={effectiveStatus}
              onChange={(e) => setStatusDraft(e.target.value)}
            >
              {options(LEAD_STATUSES).map((opt) => (
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
            disabled={saving || statusDraft === null}
            onClick={() => void saveStatus()}
          >
            {saving ? 'Saving…' : 'Save status'}
          </button>
          <Link
            className="btn btn-secondary"
            to={`/appointments?new=1&leadId=${lead.id}&phone=${encodeURIComponent(lead.phone)}`}
          >
            Book appointment
          </Link>
          <Link
            className="btn btn-secondary"
            to={`/communications?recipient=${encodeURIComponent(lead.phone)}`}
          >
            View messages
          </Link>
        </div>
      </section>

      {canManage ? (
        <section className="card">
          <h2 className="card-title">Notes</h2>
          <FormField label="Notes" hint="Visible to clinic staff only.">
            <textarea
              className="input"
              rows={4}
              value={notesDraft ?? data.notes ?? ''}
              onChange={(e) => setNotesDraft(e.target.value)}
            />
          </FormField>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || notesDraft === null}
              onClick={() => void saveNotes()}
            >
              {saving ? 'Saving…' : 'Save notes'}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Appointments</h2>
        {data.appointments.length === 0 ? (
          <EmptyState
            title="No appointments yet"
            description="Book an appointment to move this lead further along."
          />
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Lead appointments">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Service</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.appointments.map((appt) => (
                  <tr key={appt.id}>
                    <td>{formatDate(appt.date)}</td>
                    <td>{appt.time.slice(0, 5)}</td>
                    <td>{appt.service ?? '—'}</td>
                    <td>
                      <StatusBadge label={appt.status} tone={statusTone(appt.status)} />
                    </td>
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
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Communication timeline</h2>
        <CommunicationTimeline messages={data.communicationHistory} />
      </section>

      <section className="card">
        <h2 className="card-title">Activity timeline</h2>
        {data.activity.length === 0 ? (
          <EmptyState title="No activity yet" description="Changes to this lead are recorded here." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
            {[...data.activity].reverse().map((item) => (
              <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span>
                  {item.action}
                  {item.detail !== null && item.detail !== '' ? ` — ${item.detail}` : ''}
                  {item.actorEmail !== null ? ` (${item.actorEmail})` : ''}
                </span>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-label)', whiteSpace: 'nowrap' }}>
                  {formatDateTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
