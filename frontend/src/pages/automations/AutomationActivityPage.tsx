import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Paged } from '../../lib/types';
import { AUTOMATION_KINDS, JOB_STATUSES, options } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import {
  StatusBadge,
  ErrorState,
  LoadingState,
  EmptyState,
  type BadgeTone,
} from '../../components/states';

const PAGE_SIZE = 25;

interface AutomationLogRow {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  suppression_reason: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  subject_id: number;
}

const KIND_LABELS: Record<string, string> = {
  reminder: 'Appointment reminder',
  no_show: 'No-show recovery',
  recall: 'Recall follow-up',
  review: 'Review request',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function jobTone(status: string): BadgeTone {
  if (status === 'SENT') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PENDING' || status === 'SENDING') return 'warn';
  return 'default';
}

export function AutomationActivityPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const [draft, setDraft] = useState({ kind: '', status: '' });
  const [applied, setApplied] = useState({ kind: '', status: '' });
  const [offset, setOffset] = useState(0);

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.kind !== '') parts.push(`kind=${applied.kind}`);
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    return parts.join('&');
  }, [applied, offset]);

  const path =
    orgId === null ? null : `/api/organizations/${orgId}/observability/automation-logs?${query}`;
  const { status, data, error, reload } = useApi<Paged & { logs: AutomationLogRow[] }>(path);
  const logs = data?.logs ?? [];
  const isFiltered = applied.kind !== '' || applied.status !== '';

  return (
    <div>
      <PageHeader
        title="Automation activity"
        subtitle="Every scheduled automation job, what happened to it, and why"
        actions={
          <div className="btn-row">
            <Link className="btn btn-secondary" to="/automations">
              Automations overview
            </Link>
          </div>
        }
      />

      <section className="card">
        <h2 className="card-title">Filters</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(draft);
            setOffset(0);
          }}
        >
          <div className="form-grid">
            <FormField label="Automation">
              <select
                className="select"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              >
                <option value="">Any automation</option>
                {options(AUTOMATION_KINDS).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Status">
              <select
                className="select"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">Any status</option>
                {options(JOB_STATUSES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
                setDraft({ kind: '', status: '' });
                setApplied({ kind: '', status: '' });
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">Jobs</h2>
        {orgId === null ? (
          <EmptyState
            title="No clinic context"
            description="This account is not attached to a clinic, so there is no automation activity to show."
          />
        ) : null}
        {orgId !== null && status === 'loading' && data === null ? (
          <LoadingState label="Loading automation activity…" />
        ) : null}
        {orgId !== null && status === 'error' && data === null ? (
          <ErrorState
            message={error ?? 'Automation activity could not be loaded.'}
            onRetry={reload}
          />
        ) : null}
        {data !== null && logs.length === 0 ? (
          <EmptyState
            title="No activity found"
            description={
              isFiltered
                ? 'No automation jobs match the current filters. Try resetting them.'
                : 'Reminder, no-show, recall and review jobs appear here once automations run.'
            }
          />
        ) : null}
        {data !== null && logs.length > 0 ? (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Automation activity table"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Automation</th>
                    <th scope="col">Record</th>
                    <th scope="col">Status</th>
                    <th scope="col">Scheduled time</th>
                    <th scope="col">Execution time</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={`${row.kind}-${row.id}`}>
                      <td>{kindLabel(row.kind)}</td>
                      <td>
                        {row.kind === 'reminder' || row.kind === 'review' ? (
                          <Link to={`/appointments/${row.subject_id}`}>#{row.subject_id}</Link>
                        ) : (
                          `#${row.subject_id}`
                        )}
                      </td>
                      <td>
                        <StatusBadge label={row.status} tone={jobTone(row.status)} />
                      </td>
                      <td>{formatDateTime(row.scheduled_at)}</td>
                      <td>{formatDateTime(row.sent_at)}</td>
                      <td>
                        {row.last_error ??
                          row.suppression_reason ??
                          (row.attempts > 0
                            ? `${row.attempts} attempt${row.attempts === 1 ? '' : 's'}`
                            : '—')}
                      </td>
                    </tr>
                  ))}
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
