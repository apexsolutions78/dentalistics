import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch, errorMessage } from '../../lib/api';
import type { Paged } from '../../lib/types';
import { formatDateTime } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { Flash } from '../../components/Flash';
import {
  StatusBadge,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../components/states';

const PAGE_SIZE = 25;

interface FailedJobRow {
  kind: string;
  id: number;
  status: string;
  attempts: number;
  error: string | null;
  message_id: number | null;
  updated_at: string;
}

const KIND_LABELS: Record<string, string> = {
  reminder: 'Appointment reminder',
  no_show: 'No-show recovery',
  recall: 'Recall follow-up',
  review: 'Review request',
  message: 'Message',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function AutomationFailuresPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const [offset, setOffset] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const path =
    orgId === null ? null : `/api/organizations/${orgId}/observability/failed-jobs?limit=${PAGE_SIZE}&offset=${offset}`;
  const { status, data, error, reload } = useApi<Paged & { jobs: FailedJobRow[] }>(path);
  const jobs = data?.jobs ?? [];

  const retry = async (job: FailedJobRow): Promise<void> => {
    if (orgId === null) return;
    const key = `${job.kind}-${job.id}`;
    setRetrying(key);
    setFlash(null);
    setActionError(null);
    try {
      const res = await apiFetch<{ retry: { action: string } }>(
        `/api/organizations/${orgId}/observability/failed-jobs/${job.kind}/${job.id}/retry`,
        { method: 'POST' },
      );
      setFlash(
        res.retry.action === 'sent'
          ? `${kindLabel(job.kind)} #${job.id} sent on retry.`
          : `${kindLabel(job.kind)} #${job.id} requeued.`,
      );
      reload();
    } catch (err: unknown) {
      setActionError(errorMessage(err));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Failed automation jobs"
        subtitle="Jobs that could not complete, with the outcome of every retry"
        actions={
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={reload}>
              Refresh
            </button>
          </div>
        }
      />

      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}
      {actionError ? (
        <Flash kind="error" message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      <section className="card">
        <h2 className="card-title">Failures</h2>
        {orgId === null ? (
          <EmptyState
            title="No clinic context"
            description="This account is not attached to a clinic, so there are no failed jobs to show."
          />
        ) : null}
        {orgId !== null && status === 'loading' && data === null ? (
          <LoadingState label="Loading failed jobs…" />
        ) : null}
        {orgId !== null && status === 'error' && data === null ? (
          <ErrorState
            message={error ?? 'Failed jobs could not be loaded.'}
            onRetry={reload}
          />
        ) : null}
        {data !== null && jobs.length === 0 ? (
          <EmptyState
            title="No failed jobs"
            description="Automation failures appear here with a retry action. Nothing has failed recently."
          />
        ) : null}
        {data !== null && jobs.length > 0 ? (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Failed automation jobs table"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Automation</th>
                    <th scope="col">Record</th>
                    <th scope="col">Failure time</th>
                    <th scope="col">Failure category</th>
                    <th scope="col">Retry state</th>
                    <th scope="col" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const key = `${job.kind}-${job.id}`;
                    return (
                      <tr key={key}>
                        <td>{kindLabel(job.kind)}</td>
                        <td>
                          #{job.id}
                          {job.message_id !== null && job.message_id !== job.id
                            ? ` · message #${job.message_id}`
                            : ''}
                        </td>
                        <td>{formatDateTime(job.updated_at)}</td>
                        <td>{job.error ?? '—'}</td>
                        <td>
                          <StatusBadge label={job.status} tone="danger" />{' '}
                          <span style={{ fontSize: 'var(--fs-label)' }}>
                            {job.attempts} attempt{job.attempts === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={retrying !== null}
                            onClick={() => {
                              void retry(job);
                            }}
                          >
                            {retrying === key ? 'Retrying…' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              total={data.total}
              limit={data.limit}
              offset={data.offset}
              onOffset={setOffset}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
