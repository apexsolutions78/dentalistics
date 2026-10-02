import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { useMembers } from '../../lib/settings';
import type { Paged } from '../../lib/types';
import { formatDateTime } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { ErrorState, LoadingState, EmptyState } from '../../components/states';

const PAGE_SIZE = 25;

interface AuditLogRow {
  id: number;
  organization_id: number | null;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
}

export function AuditLogPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const { members } = useMembers();

  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied !== '') parts.push(`action=${encodeURIComponent(applied)}`);
    return parts.join('&');
  }, [applied, offset]);

  const path = orgId === null ? null : `/api/organizations/${orgId}/observability/audit-logs?${query}`;
  const { status, data, error, reload } = useApi<Paged & { logs: AuditLogRow[] }>(path);
  const logs = data?.logs ?? [];

  function actorLabel(row: AuditLogRow): string {
    if (row.user_id === null) return 'System';
    const match = members.find((member) => member.id === row.user_id);
    if (match !== undefined) return match.email;
    return `User #${row.user_id}`;
  }

  function resultLabel(row: AuditLogRow): string {
    if (row.detail === null) return '—';
    const reason = /(?:^|\s)reason=([^\s]+)/.exec(row.detail);
    if (reason !== null && reason[1] !== undefined) return reason[1];
    const outcome = /(?:^|\s)status=([^\s]+)/.exec(row.detail);
    if (outcome !== null && outcome[1] !== undefined) return outcome[1];
    return '—';
  }

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what in this clinic, and when"
        actions={
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={reload}>
              Refresh
            </button>
          </div>
        }
      />

      <section className="card">
        <h2 className="card-title">Filters</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(draft.trim());
            setOffset(0);
          }}
        >
          <div className="form-grid">
            <FormField label="Action" hint="Exact action name, e.g. settings_updated">
              <input
                className="input"
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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
                setDraft('');
                setApplied('');
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">Audit records</h2>
        {orgId === null ? (
          <EmptyState
            title="No clinic context"
            description="This account is not attached to a clinic, so there are no audit records to show."
          />
        ) : null}
        {orgId !== null && status === 'loading' && data === null ? (
          <LoadingState label="Loading audit records…" />
        ) : null}
        {orgId !== null && status === 'error' && data === null ? (
          <ErrorState
            message={error ?? 'Audit records could not be loaded.'}
            onRetry={reload}
          />
        ) : null}
        {data !== null && logs.length === 0 ? (
          <EmptyState
            title="No audit records"
            description={
              applied !== ''
                ? 'No audit records match the current filter. Try resetting it.'
                : 'Sign-ins, settings changes, and user management actions appear here as they happen.'
            }
          />
        ) : null}
        {data !== null && logs.length > 0 ? (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Audit log table"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Result</th>
                    <th scope="col">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td>{actorLabel(row)}</td>
                      <td>{row.action}</td>
                      <td style={{ fontSize: 'var(--fs-label)' }}>{row.detail ?? '—'}</td>
                      <td>{resultLabel(row)}</td>
                      <td>{formatDateTime(row.created_at)}</td>
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
