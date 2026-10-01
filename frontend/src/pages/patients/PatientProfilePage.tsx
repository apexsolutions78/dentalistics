import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Appointment, Lead, Message, Paged, Patient, Recall } from '../../lib/types';
import { formatDate, formatTime, fullName } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { CommunicationTimeline } from '../../components/CommunicationTimeline';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

function appointmentTone(status: string): BadgeTone {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'success';
  if (status === 'NO_SHOW' || status === 'CANCELLED') return 'danger';
  if (status === 'SCHEDULED') return 'warn';
  return 'default';
}

function recallTone(status: string): BadgeTone {
  if (status === 'DUE') return 'warn';
  if (status === 'BOOKED' || status === 'CONTACTED') return 'new';
  if (status === 'COMPLETED') return 'success';
  if (status === 'CLOSED') return 'default';
  return 'default';
}

export function PatientProfilePage() {
  const { patientId } = useParams();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const patientPath =
    orgId === null || patientId === undefined
      ? null
      : `/api/organizations/${orgId}/patients/${patientId}`;
  const patientQuery = useApi<{ patient: Patient }>(patientPath);
  const patient = patientQuery.data?.patient ?? null;

  const appointmentsPath =
    orgId === null || patientId === undefined
      ? null
      : `/api/organizations/${orgId}/appointments?patientId=${patientId}&limit=50`;
  const appointmentsQuery = useApi<Paged & { appointments: Appointment[] }>(appointmentsPath);

  const phone = patient?.phone ?? null;
  const messagesPath =
    orgId === null || phone === null
      ? null
      : `/api/organizations/${orgId}/communications?recipient=${encodeURIComponent(phone)}&limit=50`;
  const messagesQuery = useApi<Paged & { messages: Message[] }>(messagesPath);

  const leadsPath =
    orgId === null || phone === null
      ? null
      : `/api/organizations/${orgId}/leads?q=${encodeURIComponent(phone)}&limit=20`;
  const leadsQuery = useApi<Paged & { leads: Lead[] }>(leadsPath);

  const recallsPath =
    orgId === null || patientId === undefined
      ? null
      : `/api/organizations/${orgId}/recalls?patientId=${patientId}&limit=20`;
  const recallsQuery = useApi<Paged & { recalls: Recall[] }>(recallsPath);

  if (patientQuery.status === 'loading' && patient === null) {
    return (
      <div>
        <PageHeader title="Patient" />
        <LoadingState label="Loading patient…" />
      </div>
    );
  }
  if (patientQuery.status === 'error' && patient === null) {
    return (
      <div>
        <PageHeader title="Patient" />
        <ErrorState
          message={patientQuery.error ?? 'This patient could not be loaded.'}
          onRetry={patientQuery.reload}
        />
      </div>
    );
  }
  if (patient === null) return null;

  const appointments = appointmentsQuery.data?.appointments ?? [];
  const current =
    appointments.find((a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED') ?? null;
  const messages = messagesQuery.data?.messages ?? [];
  const leads = leadsQuery.data?.leads ?? [];
  const recalls = recallsQuery.data?.recalls ?? [];
  const openRecall = recalls.find((r) => r.status === 'DUE' || r.status === 'CONTACTED') ?? null;

  return (
    <div>
      <PageHeader
        title={fullName(patient.firstName, patient.lastName)}
        subtitle={`Patient since ${formatDate(patient.createdAt)}`}
        actions={<Link className="btn btn-secondary" to="/patients">Back to patients</Link>}
      />

      <section className="card">
        <h2 className="card-title">Contact information</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Patient contact details">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Phone</th>
                <td>{patient.phone}</td>
              </tr>
              <tr>
                <th scope="row">Email</th>
                <td>{patient.email ?? '—'}</td>
              </tr>
              <tr>
                <th scope="row">SMS</th>
                <td>
                  <StatusBadge
                    label={patient.smsOptOut ? 'Opted out' : 'Allowed'}
                    tone={patient.smsOptOut ? 'danger' : 'success'}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">Notes</th>
                <td>{patient.notes ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="btn-row">
          <Link
            className="btn btn-secondary"
            to={`/communications?recipient=${encodeURIComponent(patient.phone)}`}
          >
            View messages
          </Link>
          <Link className="btn btn-secondary" to={`/appointments?patientId=${patient.id}`}>
            View appointments
          </Link>
          <Link className="btn btn-secondary" to={`/appointments?new=1&patientId=${patient.id}`}>
            Book appointment
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Current appointment</h2>
        {appointmentsQuery.status === 'loading' && appointmentsQuery.data === null ? (
          <LoadingState label="Loading appointments…" />
        ) : current === null ? (
          <EmptyState
            title="No current appointment"
            description="Scheduled and confirmed appointments show up here."
          />
        ) : (
          <div>
            <p>
              <strong>
                {formatDate(current.date)} at {formatTime(current.time)}
              </strong>{' '}
              — {current.service ?? 'Service not set'}{' '}
              <StatusBadge label={current.status} tone={appointmentTone(current.status)} />
            </p>
            <Link className="btn btn-secondary" to={`/appointments/${current.id}`}>
              Open appointment
            </Link>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Appointment history</h2>
        {appointmentsQuery.status === 'error' && appointmentsQuery.data === null ? (
          <ErrorState
            message={appointmentsQuery.error ?? 'Appointments could not be loaded.'}
            onRetry={appointmentsQuery.reload}
          />
        ) : appointments.length === 0 ? (
          <EmptyState title="No appointments" description="This patient has no appointment history yet." />
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Appointment history table">
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
                {appointments.map((appt) => (
                  <tr key={appt.id}>
                    <td>{formatDate(appt.date)}</td>
                    <td>{formatTime(appt.time)}</td>
                    <td>{appt.service ?? '—'}</td>
                    <td>
                      <StatusBadge label={appt.status} tone={appointmentTone(appt.status)} />
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
        <h2 className="card-title">Communication history</h2>
        {messagesQuery.status === 'error' && messagesQuery.data === null ? (
          <ErrorState
            message={messagesQuery.error ?? 'Messages could not be loaded.'}
            onRetry={messagesQuery.reload}
          />
        ) : (
          <CommunicationTimeline messages={messages} />
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Lead history</h2>
        {leadsQuery.status === 'error' && leadsQuery.data === null ? (
          <ErrorState
            message={leadsQuery.error ?? 'Leads could not be loaded.'}
            onRetry={leadsQuery.reload}
          />
        ) : leads.length === 0 ? (
          <EmptyState title="No leads" description="No leads match this patient's phone number." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
            {leads.map((lead) => (
              <li key={lead.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span>
                  <Link to={`/leads/${lead.id}`}>{fullName(lead.firstName, lead.lastName)}</Link> —{' '}
                  {lead.requestedService ?? lead.source}
                </span>
                <span style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                  <StatusBadge label={lead.status} tone="default" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">Recall status</h2>
        {recallsQuery.status === 'error' && recallsQuery.data === null ? (
          <ErrorState
            message={recallsQuery.error ?? 'Recall status could not be loaded.'}
            onRetry={recallsQuery.reload}
          />
        ) : recalls.length === 0 ? (
          <EmptyState
            title="No recall"
            description="A recall opens automatically after a completed visit when recall automation is enabled."
          />
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Recall status table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {recalls.map((recall) => (
                  <tr key={recall.id}>
                    <td>{recall.recallType}</td>
                    <td>{formatDate(recall.dueDate)}</td>
                    <td>
                      <StatusBadge label={recall.status} tone={recallTone(recall.status)} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link className="btn btn-secondary" to="/recall">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {openRecall !== null ? (
              <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                An open recall is waiting for contact.
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
