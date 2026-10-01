import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import type { Message, Paged } from '../../lib/types';
import { MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, MESSAGE_STATUSES, options } from '../../lib/constants';
import { formatDateTime } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

const PAGE_SIZE = 20;

interface MessageFilters {
  recipient: string;
  direction: string;
  channel: string;
  status: string;
}

const EMPTY: MessageFilters = { recipient: '', direction: '', channel: '', status: '' };

function messageTone(status: string): BadgeTone {
  if (status === 'DELIVERED' || status === 'SENT' || status === 'RECEIVED') return 'success';
  if (status === 'FAILED' || status === 'UNDELIVERED') return 'danger';
  if (status === 'PENDING') return 'warn';
  return 'default';
}

export function CommunicationsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const [searchParams] = useSearchParams();
  const initialRecipient = searchParams.get('recipient') ?? '';

  const [draft, setDraft] = useState<MessageFilters>({ ...EMPTY, recipient: initialRecipient });
  const [applied, setApplied] = useState<MessageFilters>({ ...EMPTY, recipient: initialRecipient });
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.recipient !== '') parts.push(`recipient=${encodeURIComponent(applied.recipient)}`);
    if (applied.direction !== '') parts.push(`direction=${applied.direction}`);
    if (applied.channel !== '') parts.push(`channel=${applied.channel}`);
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    return parts.join('&');
  }, [applied, offset]);

  const path = orgId === null ? null : `/api/organizations/${orgId}/communications?${query}`;
  const { status, data, error, reload } = useApi<Paged & { messages: Message[] }>(path);

  const messages = data?.messages ?? [];
  const isFiltered =
    applied.recipient !== '' || applied.direction !== '' || applied.channel !== '' || applied.status !== '';

  return (
    <div>
      <PageHeader
        title="Communications"
        subtitle="Every message the clinic has sent and received"
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
            <FormField label="Patient phone" hint="Exact number, e.g. +973…">
              <input
                className="input"
                type="search"
                value={draft.recipient}
                onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
              />
            </FormField>
            <FormField label="Direction">
              <select
                className="select"
                value={draft.direction}
                onChange={(e) => setDraft({ ...draft, direction: e.target.value })}
              >
                <option value="">Any direction</option>
                {options(MESSAGE_DIRECTIONS).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Channel">
              <select
                className="select"
                value={draft.channel}
                onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
              >
                <option value="">Any channel</option>
                {options(MESSAGE_CHANNELS).map((opt) => (
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
                {options(MESSAGE_STATUSES).map((opt) => (
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
                setDraft(EMPTY);
                setApplied(EMPTY);
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">Messages</h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading messages…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Messages could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && messages.length === 0 ? (
          <EmptyState
            title="No messages found"
            description={
              isFiltered
                ? 'No messages match the current filters. Try resetting them.'
                : 'Outbound and inbound messages appear here once automations or staff send them.'
            }
          />
        ) : null}
        {data !== null && messages.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Communications table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Channel</th>
                  <th scope="col">Type</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Status</th>
                  <th scope="col">Timestamp</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <Fragment key={message.id}>
                    <tr>
                      <td>{message.recipient}</td>
                      <td>{message.channel}</td>
                      <td>{message.template !== null ? `Template: ${message.template}` : message.messageType ?? 'Message'}</td>
                      <td>
                        <StatusBadge label={message.direction} tone={message.direction === 'INBOUND' ? 'new' : 'default'} />
                      </td>
                      <td>
                        <StatusBadge label={message.status} tone={messageTone(message.status)} />
                      </td>
                      <td>{formatDateTime(message.createdAt)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setExpandedId(expandedId === message.id ? null : message.id)}
                          aria-expanded={expandedId === message.id}
                        >
                          {expandedId === message.id ? 'Hide' : 'View'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === message.id ? (
                      <tr>
                        <td colSpan={7}>
                          <div style={{ display: 'grid', gap: '6px', padding: '4px 0' }}>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                              {message.leadId !== null ? (
                                <>
                                  Related lead: <Link to={`/leads/${message.leadId}`}>open lead</Link>{' '}
                                </>
                              ) : null}
                              {message.sentAt !== null ? `Sent ${formatDateTime(message.sentAt)} · ` : ''}
                              {message.attempts} attempt(s)
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data !== null ? (
          <Pager total={data.total} limit={data.limit} offset={data.offset} onOffset={setOffset} />
        ) : null}
      </section>
    </div>
  );
}
