import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { formatDate, formatRate } from '../../lib/format';
import { formatMoney, type PatientBillingReport } from '../../lib/patientBilling';
import { PageHeader } from '../../components/PageHeader';
import { FormField } from '../../components/FormField';
import { EmptyState, ErrorState, LoadingState } from '../../components/states';
import { BillingLinks } from './BillingLinks';

function monthBounds(now = new Date()): { from: string; to: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (value: number) => String(value).padStart(2, '0');
  const last = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`,
  };
}

export function BillingReportsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const initial = monthBounds();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [applied, setApplied] = useState<{ from: string; to: string; groupBy: 'day' | 'week' | 'month' }>({
    from: initial.from,
    to: initial.to,
    groupBy: 'day',
  });

  const path = useMemo(() => {
    if (orgId === null) return null;
    const params = new URLSearchParams({
      from: applied.from,
      to: applied.to,
      groupBy: applied.groupBy,
    });
    return `/api/organizations/${orgId}/patient-billing/reports?${params.toString()}`;
  }, [orgId, applied]);
  const reportQuery = useApi<PatientBillingReport>(path);
  const report = reportQuery.data;
  const currency = report?.currency ?? '';
  const empty =
    report !== null &&
    report.summary.revenueCents === 0 &&
    report.summary.paymentsCollectedCents === 0 &&
    report.summary.expensesCents === 0 &&
    report.summary.appointments === 0 &&
    report.excluded.length === 0;

  const csvHref =
    orgId === null
      ? null
      : `/api/organizations/${orgId}/patient-billing/reports.csv?from=${applied.from}&to=${applied.to}&groupBy=${applied.groupBy}`;

  return (
    <div>
      <PageHeader
        title="Billing reports"
        subtitle="Revenue, money collected, outstanding balances, expenses, and profit, plus appointment no-shows."
        actions={<BillingLinks current="reports" />}
      />

      <section className="card">
        <h2 className="card-title">Period</h2>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied({ from, to, groupBy });
          }}
        >
          <FormField label="From">
            <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </FormField>
          <FormField label="To">
            <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </FormField>
          <FormField label="Group by">
            <select
              className="select"
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value as 'day' | 'week' | 'month')}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </FormField>
          <div className="btn-row">
            <button type="submit" className="btn btn-secondary">
              Update report
            </button>
            {csvHref ? (
              <a className="btn btn-secondary" href={csvHref}>
                Download CSV
              </a>
            ) : null}
          </div>
        </form>
      </section>

      {reportQuery.status === 'loading' && report === null ? <LoadingState label="Loading report…" /> : null}
      {reportQuery.status === 'error' && report === null ? (
        <ErrorState message={reportQuery.error ?? 'The report could not be loaded.'} onRetry={reportQuery.reload} />
      ) : null}

      {report !== null ? (
        <>
          <section className="card">
            <h2 className="card-title">Summary · {currency}</h2>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Billing summary">
              <table className="table">
                <tbody>
                  <tr>
                    <th scope="row">Revenue</th>
                    <td>{formatMoney(report.summary.revenueCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Payments collected</th>
                    <td>{formatMoney(report.summary.paymentsCollectedCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Refunds</th>
                    <td>{formatMoney(report.summary.refundsCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Outstanding</th>
                    <td>{formatMoney(report.summary.outstandingCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Expenses</th>
                    <td>{formatMoney(report.summary.expensesCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Profit</th>
                    <td>{formatMoney(report.summary.profitCents, currency)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Appointments</th>
                    <td>{report.summary.appointments}</td>
                  </tr>
                  <tr>
                    <th scope="row">No-show rate</th>
                    <td>{formatRate(report.summary.noShowRate)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {report.excluded.length > 0 ? (
              <p>
                Amounts in {report.excluded.map((row) => row.currency).join(', ')} are left out of these totals
                because the clinic currency is now {currency}.
              </p>
            ) : null}
            {empty ? (
              <EmptyState
                title="Nothing in this period"
                description="Issued invoices, payments, expenses, and appointments in the dates above will fill this report."
                preview={
                  <p>
                    <span className="badge badge-success">Sample</span> Example only — one week, revenue AED
                    1,200.00, collected AED 800.00, expenses AED 85.00, profit AED 1,115.00, no-show rate 10%.
                    Not saved data.
                  </p>
                }
              />
            ) : null}
          </section>

          <section className="card">
            <h2 className="card-title">By {applied.groupBy}</h2>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Billing report">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Collected</th>
                    <th scope="col">Outstanding</th>
                    <th scope="col">Expenses</th>
                    <th scope="col">Profit</th>
                    <th scope="col">Appointments</th>
                    <th scope="col">No-shows</th>
                  </tr>
                </thead>
                <tbody>
                  {report.buckets.map((bucket) => (
                    <tr key={bucket.start}>
                      <td>{formatDate(bucket.start)}</td>
                      <td>{formatMoney(bucket.revenueCents, currency)}</td>
                      <td>{formatMoney(bucket.netCollectedCents, currency)}</td>
                      <td>{formatMoney(bucket.outstandingCents, currency)}</td>
                      <td>{formatMoney(bucket.expensesCents, currency)}</td>
                      <td>{formatMoney(bucket.profitCents, currency)}</td>
                      <td>{bucket.appointments}</td>
                      <td>
                        {bucket.noShows} ({formatRate(bucket.noShowRate)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
