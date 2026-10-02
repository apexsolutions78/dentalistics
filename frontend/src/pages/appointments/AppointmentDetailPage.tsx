import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { Appointment, Message, Paged } from '../../lib/types';
import { APPOINTMENT_TRANSITIONS } from '../../lib/constants';
import { formatDate, formatDateTime, formatTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { CommunicationTimeline } from '../../components/CommunicationTimeline';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { StatusBadge, ErrorState, LoadingState, EmptyState } from '../../components/states';
import { statusTone } from './AppointmentsPage';

interface AutomationLogRow {
  id: number;
  kind: string;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  suppression_reason: string | null;
  attempts: number;
}

export function AppointmentDetailPage() {
  const { appointmentId } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const canEdit = can(user, 'appointments.edit');
  const canViewActivity = can(user, 'automations.activity.view');

  const path =
    orgId === null || appointmentId === undefined
      ? null
      : `/api/organizations/${orgId}/appointments/${appointmentId}`;
  const { status, data, error, reload } = useApi<{ appointment: Appointment }>(path);
  const appointment = data?.appointment ?? null;

  const messagesPath =
    orgId === null || appointment === null
      ? null
      : `/api/organizations/${orgId}/communications?recipient=${encodeURIComponent(appointment.patient.phone)}&limit=50`;
  const messagesQuery = useApi<Paged & { messages: Message[] }>(messagesPath);

  const automationBase =
    orgId === null || appointmentId === undefined || !canViewActivity
      ? null
      : `/api/organizations/${orgId}/observability/automation-logs?subjectId=${appointmentId}&limit=20&kind=`;
  const remindersQuery = useApi<Paged & { logs: AutomationLogRow[] }>(
    automationBase === null ? null : `${automationBase}reminder`,
  );
  const reviewsQuery = useApi<Paged & { logs: AutomationLogRow[] }>(
    automationBase === null ? null : `${automationBase}review`,
  );
  const automationLogs: AutomationLogRow[] = [
    ...(remindersQuery.data?.logs ?? []),
    ...(reviewsQuery.data?.logs ?? []),
  ];
  const automationStatus =
    automationBase === null
      ? 'skipped'
      : remindersQuery.status === 'error' || reviewsQuery.status === 'error'
        ? 'error'
        : remindersQuery.data !== null && reviewsQuery.data !== null
          ? 'ready'
          : 'loading';

  const { submit, saving, error: actionError, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [move, setMove] = useState({ date: '', time: '' });
  const [moveMode, setMoveMode] = useState<'reschedule' | 'rebook' | null>(null);
  const [serviceDraft, setServiceDraft] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<string | null>(null);

  const runAction = async (
    action: 'confirm' | 'cancel' | 'complete' | 'no-show',
  ): Promise<void> => {
    if (orgId === null || appointmentId === undefined) return;
    setConfirmTarget(null);
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/appointments/${appointmentId}/${action}`, {
        method: 'POST',
        body: {},
      });
      return true;
    });
    if (ok !== null) {
      const past =
        action === 'confirm'
          ? 'confirmed'
          : action === 'cancel'
            ? 'cancelled'
            : action === 'complete'
              ? 'completed'
              : 'marked as no-show';
      setFlash(`Appointment ${past}.`);
      reload();
    }
  };

  const runMove = async (): Promise<void> => {
    if (orgId === null || appointmentId === undefined || moveMode === null) return;
    clearFeedback();
    setFlash(null);
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/appointments/${appointmentId}/${moveMode}`, {
        method: 'POST',
        body: { date: move.date, time: move.time },
      });
      return true;
    });
    if (ok !== null) {
      setFlash(moveMode === 'reschedule' ? 'Appointment rescheduled.' : 'Appointment rebooked.');
      setMoveMode(null);
      setMove({ date: '', time: '' });
      reload();
    }
  };

  const saveDetails = async (): Promise<void> => {
    if (orgId === null || appointmentId === undefined || data === null) return;
    clearFeedback();
    setFlash(null);
    const body: Record<string, unknown> = {};
    if (serviceDraft !== null) body.service = serviceDraft;
    if (providerDraft !== null) body.provider = providerDraft;
    if (Object.keys(body).length === 0) return;
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/appointments/${appointmentId}`, {
        method: 'PATCH',
        body,
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Appointment updated.');
      setServiceDraft(null);
      setProviderDraft(null);
      reload();
    }
  };

  if (status === 'loading' && appointment === null) {
    return (
      <div>
        <PageHeader title="Appointment" />
        <LoadingState label="Loading appointment…" />
      </div>
    );
  }
  if (status === 'error' && appointment === null) {
    return (
      <div>
        <PageHeader title="Appointment" />
        <ErrorState message={error ?? 'This appointment could not be loaded.'} onRetry={reload} />
      </div>
    );
  }
  if (appointment === null) return null;

  const allowed = APPOINTMENT_TRANSITIONS[appointment.status] ?? [];
  const canRebook = appointment.status === 'NO_SHOW' || appointment.status === 'CANCELLED';

  return (
    <div>
      <PageHeader
        title={`${fullName(appointment.patient.firstName, appointment.patient.lastName)} — ${formatDate(appointment.date)} ${formatTime(appointment.time)}`}
        subtitle={appointment.service ?? 'Service not set'}
        actions={<Link className="btn btn-secondary" to="/appointments">Back to appointments</Link>}
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {actionError ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}

      <section className="card">
        <h2 className="card-title">
          Details <StatusBadge label={appointment.status} tone={statusTone(appointment.status)} />
        </h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Appointment details">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Patient</th>
                <td>
                  <Link to={`/patients/${appointment.patientId}`}>
                    {fullName(appointment.patient.firstName, appointment.patient.lastName)}
                  </Link>{' '}
                  — {appointment.patient.phone}
                </td>
              </tr>
              <tr>
                <th scope="row">Date</th>
                <td>{formatDate(appointment.date)}</td>
              </tr>
              <tr>
                <th scope="row">Time</th>
                <td>{formatTime(appointment.time)}</td>
              </tr>
              <tr>
                <th scope="row">Service</th>
                <td>{appointment.service ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">Provider</th>
                <td>{appointment.provider ?? '—'}</td>
              </tr>
              {appointment.leadId !== null ? (
                <tr>
                  <th scope="row">Linked lead</th>
                  <td>
                    <Link to={`/leads/${appointment.leadId}`}>Open lead</Link>
                  </td>
                </tr>
              ) : null}
              {appointment.previousAppointmentId !== null ? (
                <tr>
                  <th scope="row">Previous appointment</th>
                  <td>
                    <Link to={`/appointments/${appointment.previousAppointmentId}`}>Open previous</Link>
                  </td>
                </tr>
              ) : null}
              <tr>
                <th scope="row">Created</th>
                <td>{formatDateTime(appointment.createdAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          {allowed.includes('CONFIRMED') ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void runAction('confirm')}
            >
              Confirm
            </button>
          ) : null}
          {allowed.includes('NO_SHOW') ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setConfirmTarget('no-show')}
            >
              Mark no-show
            </button>
          ) : null}
          {allowed.includes('COMPLETED') && canEdit ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setConfirmTarget('complete')}
            >
              Mark completed
            </button>
          ) : null}
          {allowed.includes('CANCELLED') && canEdit ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={saving}
              onClick={() => setConfirmTarget('cancel')}
            >
              Cancel appointment
            </button>
          ) : null}
          {allowed.includes('RESCHEDULED') && canEdit ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                setMoveMode('reschedule');
                clearFeedback();
              }}
            >
              Reschedule
            </button>
          ) : null}
          {canRebook ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => {
                setMoveMode('rebook');
                clearFeedback();
              }}
            >
              Rebook
            </button>
          ) : null}
        </div>
        {canEdit && (appointment.status === 'SCHEDULED' || appointment.status === 'CONFIRMED') ? (
          <div style={{ marginTop: '12px' }}>
            <div className="form-grid">
              <FormField label="Service">
                <input
                  className="input"
                  value={serviceDraft ?? appointment.service ?? ''}
                  onChange={(e) => setServiceDraft(e.target.value)}
                />
              </FormField>
              <FormField label="Provider">
                <input
                  className="input"
                  value={providerDraft ?? appointment.provider ?? ''}
                  onChange={(e) => setProviderDraft(e.target.value)}
                />
              </FormField>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || (serviceDraft === null && providerDraft === null)}
                onClick={() => void saveDetails()}
              >
                {saving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </div>
        ) : null}
        {!canEdit && !allowed.includes('CONFIRMED') && !canRebook ? (
          <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
            Further changes require the clinic owner or an administrator.
          </p>
        ) : null}
      </section>

      {moveMode !== null ? (
        <section className="card">
          <h2 className="card-title">{moveMode === 'reschedule' ? 'Reschedule' : 'Rebook'}</h2>
          {actionError ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
          <div className="form-grid">
            <FormField label="New date" required>
              <input
                className="input"
                type="date"
                value={move.date}
                onChange={(e) => setMove({ ...move, date: e.target.value })}
              />
            </FormField>
            <FormField label="New time" required>
              <input
                className="input"
                type="time"
                value={move.time}
                onChange={(e) => setMove({ ...move, time: e.target.value })}
              />
            </FormField>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || move.date === '' || move.time === ''}
              onClick={() => void runMove()}
            >
              {saving ? 'Saving…' : moveMode === 'reschedule' ? 'Reschedule' : 'Rebook'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMoveMode(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2 className="card-title">Communication history</h2>
        {messagesQuery.status === 'error' && messagesQuery.data === null ? (
          <ErrorState
            message={messagesQuery.error ?? 'Messages could not be loaded.'}
            onRetry={messagesQuery.reload}
          />
        ) : messagesQuery.data === null && messagesQuery.status === 'loading' ? (
          <LoadingState label="Loading messages…" />
        ) : (
          <CommunicationTimeline messages={messagesQuery.data?.messages ?? []} />
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Automation status</h2>
        {!canViewActivity ? (
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--fs-label)' }}>
            Reminders, no-show recovery and review requests run automatically based on the clinic's
            automation settings. Ask the owner or administrator for activity details.
          </p>
        ) : automationStatus === 'loading' ? (
          <LoadingState label="Loading automation activity…" />
        ) : automationStatus === 'error' ? (
          <ErrorState
            message={remindersQuery.error ?? reviewsQuery.error ?? 'Automation activity could not be loaded.'}
            onRetry={() => {
              remindersQuery.reload();
              reviewsQuery.reload();
            }}
          />
        ) : automationLogs.length === 0 ? (
          <EmptyState
            title="No automation activity"
            description="No scheduled jobs were found for this appointment yet."
          />
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Automation activity table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Automation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Sent</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {automationLogs.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td>{row.kind.replace('_', ' ')}</td>
                    <td>
                      <StatusBadge
                        label={row.status}
                        tone={
                          row.status === 'SENT'
                            ? 'success'
                            : row.status === 'FAILED'
                              ? 'danger'
                              : row.status === 'PENDING' || row.status === 'SENDING'
                                ? 'warn'
                                : 'default'
                        }
                      />
                    </td>
                    <td>{formatDateTime(row.scheduled_at)}</td>
                    <td>{formatDateTime(row.sent_at)}</td>
                    <td>
                      {row.last_error ??
                        row.suppression_reason ??
                        (row.attempts > 0 ? `${row.attempts} attempt(s)` : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget === 'cancel'
            ? 'Cancel this appointment?'
            : confirmTarget === 'no-show'
              ? 'Mark as no-show?'
              : 'Mark as completed?'
        }
        body={
          confirmTarget === 'cancel'
            ? 'Reminders will be stopped. The appointment stays in history as cancelled.'
            : confirmTarget === 'no-show'
              ? 'No-show recovery messaging may start for this patient.'
              : 'Completion closes related follow-ups and may open a recall and a review request.'
        }
        confirmLabel={
          confirmTarget === 'cancel'
            ? 'Cancel appointment'
            : confirmTarget === 'no-show'
              ? 'Mark no-show'
              : 'Mark completed'
        }
        danger={confirmTarget === 'cancel' || confirmTarget === 'no-show'}
        busy={saving}
        onConfirm={() => {
          if (confirmTarget !== null) void runAction(confirmTarget as 'confirm' | 'cancel' | 'complete' | 'no-show');
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
