import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../lib/useApi';
import { formatDateTime } from '../../lib/format';
import { ErrorState, LoadingState, EmptyState } from '../../components/states';

const TYPES = [
  'message',
  'call',
  'lead',
  'appointment',
  'reminder',
  'recall',
  'invoice',
  'payment',
  'refund',
  'chart',
  'review',
  'note',
] as const;

interface TimelineItem {
  id: string;
  type: (typeof TYPES)[number];
  at: string;
  title: string;
  detail: string | null;
  href: string | null;
}

export function PatientTimeline({ path }: { path: string }) {
  const [type, setType] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const query = `${path}?limit=${limit}&offset=${offset}${type === '' ? '' : `&type=${type}`}`;
  const result = useApi<{ items: TimelineItem[]; total: number; limit: number; offset: number }>(query);
  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;

  return (
    <section className="card">
      <h2 className="card-title">Timeline</h2>
      <div className="btn-row" role="group" aria-label="Filter timeline">
        <button
          type="button"
          className={type === '' ? 'btn btn-primary' : 'btn btn-secondary'}
          onClick={() => {
            setType('');
            setOffset(0);
          }}
        >
          All
        </button>
        {TYPES.map((name) => (
          <button
            key={name}
            type="button"
            className={type === name ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => {
              setType(name);
              setOffset(0);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {result.status === 'loading' && result.data === null ? <LoadingState label="Loading timeline…" /> : null}
      {result.status === 'error' && result.data === null ? (
        <ErrorState message={result.error ?? 'The timeline could not be loaded.'} onRetry={result.reload} />
      ) : null}
      {result.data !== null && items.length === 0 ? (
        <EmptyState title="Nothing on the timeline yet" description="Messages, visits, recalls, and chart changes will appear here." />
      ) : null}
      {items.length > 0 ? (
        <ol className="patient-timeline">
          {items.map((entry) => (
            <li key={entry.id}>
              <div className="patient-timeline-meta">
                <span className="badge">{entry.type}</span>
                <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
              </div>
              <div>
                {entry.href !== null ? <Link to={entry.href}>{entry.title}</Link> : <strong>{entry.title}</strong>}
                {entry.detail !== null ? <p className="sub">{entry.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {total > limit ? (
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Newer
          </button>
          <button type="button" className="btn btn-secondary" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
            Older
          </button>
        </div>
      ) : null}
    </section>
  );
}
