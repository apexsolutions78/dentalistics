import { useState } from 'react';
import { apiFetch, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { formatDate } from '../../lib/format';
import type { TrialRow } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { ErrorState, LoadingState, EmptyState, StatusBadge } from '../../components/states';

function isExpired(row: TrialRow): boolean {
  if (row.trialEndsAt === null) return false;
  const ends = Date.parse(row.trialEndsAt);
  return !Number.isNaN(ends) && ends <= Date.now();
}

export function TrialsPage() {
  const { status, data, error, reload } = useApi<{ trials: TrialRow[] }>('/api/admin/trials');
  const trials = data?.trials ?? [];
  const [activating, setActivating] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activated, setActivated] = useState<string | null>(null);

  async function activate(row: TrialRow): Promise<void> {
    setActivating(row.id);
    setActionError(null);
    setActivated(null);
    try {
      await apiFetch(`/api/admin/organizations/${row.id}/activate`, { method: 'POST' });
      setActivated(row.name);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setActivating(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Trial clinics"
        subtitle="Self-serve signups on the free plan and their activation state"
        actions={
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Refresh
          </button>
        }
      />
      {activated !== null ? (
        <p className="banner banner-success" role="status">
          {activated} is now on the Full Plan.
        </p>
      ) : null}
      {actionError !== null ? (
        <p className="banner banner-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <section className="card">
        <h2 className="card-title">Trials</h2>
        {status === 'loading' ? <LoadingState label="Loading trials…" /> : null}
        {status === 'error' ? <ErrorState message={error ?? 'Something went wrong.'} /> : null}
        {status === 'success' && trials.length === 0 ? (
          <EmptyState
            title="No trial clinics"
            description="Clinics that sign up for the free trial will appear here."
          />
        ) : null}
        {trials.length > 0 ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Clinic</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {trials.map((row) => {
                  const expired = isExpired(row);
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        {row.trialEndsAt === null ? (
                          <StatusBadge label="No expiry set" tone="warn" />
                        ) : expired ? (
                          <StatusBadge label={`Expired ${formatDate(row.trialEndsAt)}`} tone="danger" />
                        ) : (
                          <StatusBadge
                            label={`Active until ${formatDate(row.trialEndsAt)}`}
                            tone="success"
                          />
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={activating === row.id}
                          onClick={() => {
                            void activate(row);
                          }}
                        >
                          {activating === row.id ? 'Activating…' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
