import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Paged } from '../../lib/types';
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

const WEBHOOK_SOURCES = ['telephony', 'whatsapp'] as const;

interface WebhookEventRow {
  id: number;
  source: string;
  request_method: string;
  http_status: number;
  outcome: string;
  provider_key: string | null;
  detail: string | null;
  created_at: string;
}

function sourceLabel(source: string): string {
  if (source === 'whatsapp') return 'WhatsApp';
  if (source === 'telephony') return 'Telephony';
  return source;
}

function outcomeTone(outcome: string): BadgeTone {
  if (outcome === 'processed' || outcome === 'challenge_verified') return 'success';
  if (outcome === 'duplicate' || outcome === 'disabled') return 'warn';
  if (
    outcome.startsWith('invalid_') ||
    outcome === 'rate_limited' ||
    outcome === 'org_not_found' ||
    outcome === 'org_inactive' ||
    outcome === 'unknown_provider'
  ) {
    return 'danger';
  }
  return 'default';
}

function idempotencyLabel(outcome: string): string {
  if (outcome === 'duplicate') return 'Duplicate ignored';
  if (outcome === 'processed') return 'Unique';
  return '—';
}

export function WebhooksPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;

  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied !== '') parts.push(`source=${applied}`);
    return parts.join('&');
  }, [applied, offset]);

  const path =
    orgId === null ? null : `/api/organizations/${orgId}/observability/webhook-logs?${query}`;
  const { status, data, error, reload } = useApi<Paged & { events: WebhookEventRow[] }>(path);
  const events = data?.events ?? [];

  return (
    <div>
      <PageHeader
        title="Webhook activity"
        subtitle="Provider deliveries this clinic received — metadata only, never payloads"
        actions={<div className="btn-row"><button type="button" className="btn btn-secondary" onClick={reload}>Refresh</button></div>}
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
            <FormField label="Source">
              <select
                className="select"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              >
                <option value="">Any source</option>
                {WEBHOOK_SOURCES.map((value) => (
                  <option key={value} value={value}>
                    {sourceLabel(value)}
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
        <h2 className="card-title">Received events</h2>
        {orgId === null ? (
          <EmptyState
            title="No clinic context"
            description="This account is not attached to a clinic, so there is no webhook activity to show."
          />
        ) : null}
        {orgId !== null && status === 'loading' && data === null ? (
          <LoadingState label="Loading webhook activity…" />
        ) : null}
        {orgId !== null && status === 'error' && data === null ? (
          <ErrorState
            message={error ?? 'Webhook activity could not be loaded.'}
            onRetry={reload}
          />
        ) : null}
        {data !== null && events.length === 0 ? (
          <EmptyState
            title="No webhook events"
            description="Telephony and WhatsApp deliveries appear here once the providers are configured and traffic arrives."
          />
        ) : null}
        {data !== null && events.length > 0 ? (
          <>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Webhook activity table"
            >
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Event type</th>
                    <th scope="col">Received</th>
                    <th scope="col">Processing status</th>
                    <th scope="col">Idempotency status</th>
                    <th scope="col">Error state</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>{event.provider_key ?? '—'}</td>
                      <td>{sourceLabel(event.source)}</td>
                      <td>{formatDateTime(event.created_at)}</td>
                      <td>
                        <StatusBadge
                          label={`${event.outcome} (HTTP ${event.http_status})`}
                          tone={outcomeTone(event.outcome)}
                        />
                      </td>
                      <td>{idempotencyLabel(event.outcome)}</td>
                      <td>{event.http_status >= 400 ? `HTTP ${event.http_status}` : '—'}</td>
                      <td style={{ fontSize: 'var(--fs-label)' }}>{event.detail ?? '—'}</td>
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
