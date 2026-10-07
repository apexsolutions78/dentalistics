import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { DashboardResult } from '../../lib/types';
import { formatDate, formatRate } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState } from '../../components/states';
import { FormField } from '../../components/FormField';

interface MetricCardProps {
  label: string;
  value: string;
  definition?: string;
  to?: string;
}

function MetricCard({ label, value, definition, to }: MetricCardProps) {
  const body = (
    <>
      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{value}</div>
    </>
  );
  if (to !== undefined) {
    return (
      <div className="card" title={definition} style={{ margin: 0 }}>
        <Link to={to} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
          {body}
        </Link>
      </div>
    );
  }
  return (
    <div className="card" title={definition} style={{ margin: 0 }}>
      {body}
    </div>
  );
}

function count(value: number): string {
  return String(value);
}

export function DashboardPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params: string[] = [];
  if (from !== '') params.push(`from=${encodeURIComponent(from)}`);
  if (to !== '') params.push(`to=${encodeURIComponent(to)}`);
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  const path = orgId === null ? null : `/api/organizations/${orgId}/dashboard${query}`;

  const { status, data, error, reload } = useApi<DashboardResult>(path);

  if (status === 'loading' && data === null) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Clinic communication and appointment activity" />
        <LoadingState label="Loading dashboard…" />
      </div>
    );
  }
  if (status === 'error' && data === null) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Clinic communication and appointment activity" />
        <ErrorState message={error ?? 'The dashboard could not be loaded.'} onRetry={reload} />
      </div>
    );
  }
  if (data === null) return null;

  const m = data.metrics;
  const defs = data.definitions.metrics;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Showing ${formatDate(data.window.from)} – ${formatDate(data.window.to)}`}
      />
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <div className="form-grid">
          <FormField label="From">
            <input
              className="input"
              type="date"
              value={from}
              max={to !== '' ? to : undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </FormField>
          <FormField label="To">
            <input
              className="input"
              type="date"
              value={to}
              min={from !== '' ? from : undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </FormField>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary">
            Apply range
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Reset to default
          </button>
        </div>
      </form>

      <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
        <MetricCard label="New leads" value={count(m.leads.new)} definition={defs['leads.new']} to="/leads?status=NEW" />
        <MetricCard
          label="Appointments booked"
          value={count(m.appointments.booked)}
          definition={defs['appointments.booked']}
          to="/appointments"
        />
        <MetricCard
          label="Confirmed appointments"
          value={count(m.appointments.confirmed)}
          definition={defs['appointments.confirmed']}
          to="/appointments?status=CONFIRMED"
        />
        <MetricCard
          label="No-shows"
          value={count(m.appointments.noShows)}
          definition={defs['appointments.noShows']}
          to="/appointments?status=NO_SHOW"
        />
        <MetricCard
          label="Rebooked"
          value={count(m.appointments.rebooked)}
          definition={defs['appointments.rebooked']}
          to="/appointments"
        />
        <MetricCard label="Recall opportunities" value={count(m.recall.due)} definition={defs['recall.due']} to="/recall" />
      </div>

      <section className="card">
        <h2 className="card-title">Lead performance</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Lead performance table">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Contacted leads</th>
                <td>{count(m.leads.contacted)}</td>
              </tr>
              <tr>
                <th scope="row">Converted leads</th>
                <td>{count(m.leads.converted)}</td>
              </tr>
              <tr>
                <th scope="row">Response rate</th>
                <td>{formatRate(m.leads.responseRate)}</td>
              </tr>
              <tr>
                <th scope="row">Lead responses</th>
                <td>{count(m.leadResponses)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Appointment performance</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Appointment performance table">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Scheduled</th>
                <td>{count(m.appointments.scheduled)}</td>
              </tr>
              <tr>
                <th scope="row">Completed</th>
                <td>{count(m.appointments.completed)}</td>
              </tr>
              <tr>
                <th scope="row">Recall contacted</th>
                <td>{count(m.recall.contacted)}</td>
              </tr>
              <tr>
                <th scope="row">Recall booked</th>
                <td>{count(m.recall.booked)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Communication activity</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Communication activity table">
          <table className="table">
            <tbody>
              <tr>
                <th scope="row">Messages sent</th>
                <td>{count(m.messages.sent)}</td>
              </tr>
              <tr>
                <th scope="row">Patient replies</th>
                <td>{count(m.messages.patientReplies)}</td>
              </tr>
              <tr>
                <th scope="row">Delivered</th>
                <td>
                  {count(m.delivery.delivered)} ({formatRate(m.delivery.deliveredRate)})
                </td>
              </tr>
              <tr>
                <th scope="row">Failed</th>
                <td>
                  {count(m.failures.failed)} ({formatRate(m.failures.failedRate)})
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card card-dark">
        <h2 className="card-title">Daily trends</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Daily trends table">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">New leads</th>
                <th scope="col">Messages sent</th>
                <th scope="col">Patient replies</th>
              </tr>
            </thead>
            <tbody>
              {data.trends.daily.map((point) => (
                <tr key={point.date}>
                  <td>{formatDate(point.date)}</td>
                  <td>{point.newLeads}</td>
                  <td>{point.messagesSent}</td>
                  <td>{point.patientReplies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
