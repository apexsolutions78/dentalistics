import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { ReceptionistWorkspace } from '../../lib/types';
import { formatDate, formatDateTime, formatTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';
import { Flash } from '../../components/Flash';

function statusTone(status: string): BadgeTone {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'NO_SHOW' || status === 'CANCELLED') return 'danger';
  if (status === 'SCHEDULED') return 'warn';
  return 'default';
}

function QueueCard({
  title,
  count,
  emptyTitle,
  emptyDescription,
  children,
}: {
  title: string;
  count: number;
  emptyTitle: string;
  emptyDescription: string;
  children?: ReactNode;
}) {
  return (
    <section className="card">
      <h2 className="card-title">
        {title} <span className="badge">{count}</span>
      </h2>
      {count === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        children
      )}
    </section>
  );
}

export function WorkspacePage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const path = orgId === null ? null : `/api/organizations/${orgId}/receptionist/workspace`;
  const { status, data, error, reload } = useApi<ReceptionistWorkspace>(path);
  const { submit, saving, error: actionError, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);

  const confirmAppointment = useCallback(
    (appointmentId: number): void => {
      if (orgId === null) return;
      clearFeedback();
      void submit(async () => {
        await apiFetch(`/api/organizations/${orgId}/appointments/${appointmentId}/confirm`, {
          method: 'POST',
          body: {},
        });
        return true;
      }).then((ok) => {
        if (ok !== null) {
          setFlash('Appointment confirmed.');
          reload();
        }
      });
    },
    [orgId, submit, clearFeedback, reload, setFlash],
  );

  if (status === 'loading' && data === null) {
    return (
      <div>
        <PageHeader title="Workspace" subtitle="What needs attention right now" />
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }
  if (status === 'error' && data === null) {
    return (
      <div>
        <PageHeader title="Workspace" subtitle="What needs attention right now" />
        <ErrorState message={error ?? 'The workspace could not be loaded.'} onRetry={reload} />
      </div>
    );
  }
  if (data === null) return null;

  const q = data.queues;

  return (
    <div>
      <PageHeader
        title="Workspace"
        subtitle={`Clinic date ${formatDate(data.date)} (${data.timezone}) · generated ${formatDateTime(data.generatedAt)}`}
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {actionError ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}

      <QueueCard
        title="Tasks"
        count={q.tasks.count}
        emptyTitle="Nothing needs attention"
        emptyDescription="New leads, missed calls, replies, confirmations, no-shows and due recalls appear here."
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
          {q.tasks.items.map((task) => (
            <li key={`${task.queue}-${task.type}-${task.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <span>{task.label}</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-label)', whiteSpace: 'nowrap' }}>
                {formatDateTime(task.at)}
              </span>
            </li>
          ))}
        </ul>
      </QueueCard>

      <QueueCard
        title="New leads"
        count={q.newLeads.count}
        emptyTitle="No new leads"
        emptyDescription="New website enquiries and manually added leads appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="New leads table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Phone</th>
                <th scope="col">Source</th>
                <th scope="col">Created</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.newLeads.items.map((lead) => (
                <tr key={lead.id}>
                  <td>{fullName(lead.firstName, lead.lastName)}</td>
                  <td>{lead.phone}</td>
                  <td>{lead.source}</td>
                  <td>{formatDateTime(lead.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn btn-secondary" to={`/leads/${lead.id}`}>
                      Open lead
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>

      <QueueCard
        title="Missed calls"
        count={q.missedCalls.count}
        emptyTitle="No missed calls"
        emptyDescription="Missed, rejected and busy calls from the last 30 days appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Missed calls table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Caller</th>
                <th scope="col">Outcome</th>
                <th scope="col">Time</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.missedCalls.items.map((call) => (
                <tr key={call.id}>
                  <td>{call.callerNumber}</td>
                  <td>
                    <StatusBadge label={call.callOutcome} tone="warn" />
                  </td>
                  <td>{formatDateTime(call.occurredAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {call.leadId !== null ? (
                      <Link className="btn btn-secondary" to={`/leads/${call.leadId}`}>
                        Open lead
                      </Link>
                    ) : (
                      <Link className="btn btn-secondary" to={`/communications?recipient=${encodeURIComponent(call.callerNumber)}`}>
                        View messages
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>

      <QueueCard
        title="Patient replies"
        count={q.patientReplies.count}
        emptyTitle="No recent replies"
        emptyDescription="Inbound patient messages from the last 30 days appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Patient replies table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">Message</th>
                <th scope="col">Received</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.patientReplies.items.map((reply) => (
                <tr key={reply.id}>
                  <td>{reply.recipient}</td>
                  <td>{reply.body}</td>
                  <td>{formatDateTime(reply.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {reply.leadId !== null ? (
                      <Link className="btn btn-secondary" to={`/leads/${reply.leadId}`}>
                        Open lead
                      </Link>
                    ) : (
                      <Link className="btn btn-secondary" to={`/communications?recipient=${encodeURIComponent(reply.recipient)}`}>
                        Conversation
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>

      <QueueCard
        title="Upcoming appointments"
        count={q.upcomingAppointments.count}
        emptyTitle="No upcoming appointments"
        emptyDescription="Scheduled and confirmed appointments from today onward appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Upcoming appointments table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">When</th>
                <th scope="col">Service</th>
                <th scope="col">Status</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.upcomingAppointments.items.map((appt) => (
                <tr key={appt.id}>
                  <td>{appt.patientName}</td>
                  <td>
                    {formatDate(appt.date)} {formatTime(appt.time)}
                  </td>
                  <td>{appt.service ?? '—'}</td>
                  <td>
                    <StatusBadge label={appt.status} tone={statusTone(appt.status)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {appt.needsConfirmation ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={saving}
                        onClick={() => confirmAppointment(appt.id)}
                      >
                        {saving ? 'Confirming…' : 'Confirm'}
                      </button>
                    ) : null}{' '}
                    <Link className="btn btn-secondary" to={`/appointments/${appt.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>

      <QueueCard
        title="No-shows"
        count={q.noShows.count}
        emptyTitle="No recent no-shows"
        emptyDescription="No-show appointments from the last 30 days appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="No-shows table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Appointment</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.noShows.items.map((appt) => (
                <tr key={appt.id}>
                  <td>{appt.patientName}</td>
                  <td>
                    {formatDate(appt.date)} {formatTime(appt.time)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn btn-secondary" to={`/appointments/${appt.id}`}>
                      Rebook
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>

      <QueueCard
        title="Recall opportunities"
        count={q.recallOpportunities.count}
        emptyTitle="No recall opportunities"
        emptyDescription="Patients due for a recall appear here."
      >
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Recall opportunities table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Patient</th>
                <th scope="col">Due date</th>
                <th scope="col">Overdue</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {q.recallOpportunities.items.map((recall) => (
                <tr key={recall.id}>
                  <td>{recall.patientName}</td>
                  <td>{formatDate(recall.dueDate)}</td>
                  <td>
                    {recall.daysSinceDue > 0
                      ? `${recall.daysSinceDue} day${recall.daysSinceDue === 1 ? '' : 's'} overdue`
                      : 'due soon'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn btn-secondary" to="/recall">
                      Open recall list
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueueCard>
    </div>
  );
}
