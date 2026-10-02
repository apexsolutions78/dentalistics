import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Paged, Settings } from '../../lib/types';
import { AUTOMATION_KINDS, options } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

const PAGE_SIZE = 25;

const JOB_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'SUPPRESSED'] as const;

const SECTION_LABELS: Record<string, string> = {
  reminder: 'Appointment reminders',
  noShow: 'No-show recovery',
  recall: 'Recall follow-ups',
  review: 'Review requests',
  leadAck: 'Lead acknowledgement',
  missedCall: 'Missed-call response',
};

function titleCase(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function describeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : null;
  return null;
}

function jobTone(status: string): BadgeTone {
  if (status === 'SENT') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PENDING' || status === 'SENDING') return 'warn';
  return 'default';
}

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

export function AutomationsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const settingsPath = orgId === null ? null : `/api/organizations/${orgId}/settings`;
  const settingsQuery = useApi<Settings>(settingsPath);

  const [draft, setDraft] = useState({ status: '', kind: '' });
  const [applied, setApplied] = useState({ status: '', kind: '' });
  const [offset, setOffset] = useState(0);

  const logsQueryText = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    if (applied.kind !== '') parts.push(`kind=${applied.kind}`);
    return parts.join('&');
  }, [applied, offset]);

  const logsPath =
    orgId === null ? null : `/api/organizations/${orgId}/observability/automation-logs?${logsQueryText}`;
  const logsQuery = useApi<Paged & { logs: AutomationLogRow[] }>(logsPath);
  const logs = logsQuery.data?.logs ?? [];

  const automations = settingsQuery.data?.automations ?? null;

  return (
    <div>
      <PageHeader
        title="Automations"
        subtitle="What runs automatically, and what happened recently"
        actions={
          <div className="btn-row">
            <Link className="btn btn-secondary" to="/automations/activity">
              Activity log
            </Link>
            <Link className="btn btn-secondary" to="/settings">
              Configure in Settings
            </Link>
          </div>
        }
      />

      <section className="card">
        <h2 className="card-title">Automation overview</h2>
        {settingsQuery.status === 'loading' && settingsQuery.data === null ? (
          <LoadingState label="Loading automations…" />
        ) : settingsQuery.status === 'error' && settingsQuery.data === null ? (
          <ErrorState
            message={settingsQuery.error ?? 'Automation settings could not be loaded.'}
            onRetry={settingsQuery.reload}
          />
        ) : automations === null ? null : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Automation overview table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Automation</th>
                  <th scope="col">State</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Configuration</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(automations).map(([key, section]) => {
                  const config = section.config as unknown as Record<string, unknown>;
                  const details = Object.entries(config)
                    .filter(([k]) => k !== 'enabled' && k !== 'channel' && k !== 'provider' && k !== 'templates')
                    .map(([k, v]) => ({ key: k, value: describeValue(v) }))
                    .filter((row) => row.value !== null);
                  const templates = config.templates;
                  const hasTemplates = templates !== undefined && templates !== null;
                  return (
                    <tr key={key}>
                      <td>{SECTION_LABELS[key] ?? titleCase(key)}</td>
                      <td>
                        <StatusBadge
                          label={config.enabled === true ? 'Enabled' : 'Disabled'}
                          tone={config.enabled === true ? 'success' : 'default'}
                        />
                      </td>
                      <td>{typeof config.channel === 'string' ? config.channel : '—'}</td>
                      <td>
                        {details.map((row) => `${titleCase(row.key)}: ${row.value}`).join(' · ')}
                        {hasTemplates ? ' · Custom templates' : ''}
                      </td>
                      <td>{section.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)', marginTop: '8px' }}>
          Templates and provider keys are edited under Settings. Deployment-level values are set in
          the server environment.
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Recent activity</h2>
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
                setDraft({ status: '', kind: '' });
                setApplied({ status: '', kind: '' });
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>

        <div style={{ marginTop: '16px' }}>
          {logsQuery.status === 'loading' && logsQuery.data === null ? (
            <LoadingState label="Loading activity…" />
          ) : logsQuery.status === 'error' && logsQuery.data === null ? (
            <ErrorState
              message={logsQuery.error ?? 'Automation activity could not be loaded.'}
              onRetry={logsQuery.reload}
            />
          ) : logsQuery.data !== null && logs.length === 0 ? (
            <EmptyState
              title="No activity found"
              description="No automation jobs match the current filters."
            />
          ) : logsQuery.data !== null ? (
            <>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Automation activity table">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Automation</th>
                      <th scope="col">Subject</th>
                      <th scope="col">Status</th>
                      <th scope="col">Scheduled</th>
                      <th scope="col">Sent</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((row) => (
                      <tr key={`${row.kind}-${row.id}`}>
                        <td>{row.kind.replace('_', ' ')}</td>
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
                            (row.attempts > 0 ? `${row.attempts} attempt(s)` : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                total={logsQuery.data.total}
                limit={logsQuery.data.limit}
                offset={logsQuery.data.offset}
                onOffset={setOffset}
              />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
