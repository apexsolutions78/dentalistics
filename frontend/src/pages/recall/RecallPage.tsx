import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { canManageSettings, useAuth } from '../../lib/auth';
import { useApi } from '../../lib/useApi';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { Paged, Recall } from '../../lib/types';
import { RECALL_STATUSES, options } from '../../lib/constants';
import { formatDate } from '../../lib/format';
import { PageHeader } from '../../components/PageHeader';
import { Pager } from '../../components/Pager';
import { FormField } from '../../components/FormField';
import { Flash } from '../../components/Flash';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge, ErrorState, LoadingState, EmptyState, type BadgeTone } from '../../components/states';

const PAGE_SIZE = 20;

const CLOSE_REASONS = [
  'staff_closed',
  'rebooked_elsewhere',
  'no_response',
  'not_applicable',
  'other',
] as const;

function recallTone(status: string): BadgeTone {
  if (status === 'DUE') return 'warn';
  if (status === 'BOOKED' || status === 'COMPLETED') return 'success';
  if (status === 'CLOSED') return 'default';
  return 'new';
}

interface RecallFilters {
  status: string;
  q: string;
  dueFrom: string;
  dueTo: string;
}

const EMPTY: RecallFilters = { status: '', q: '', dueFrom: '', dueTo: '' };

export function RecallPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const canManage = canManageSettings(user);

  const [draft, setDraft] = useState<RecallFilters>(EMPTY);
  const [applied, setApplied] = useState<RecallFilters>(EMPTY);
  const [offset, setOffset] = useState(0);
  const [closeTarget, setCloseTarget] = useState<Recall | null>(null);
  const [closeReason, setCloseReason] = useState<string>('staff_closed');
  const { submit, saving, error: actionError, clearFeedback } = useSubmit();
  const [flash, setFlash] = useState<string | null>(null);

  const query = useMemo(() => {
    const parts = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    if (applied.status !== '') parts.push(`status=${applied.status}`);
    if (applied.q !== '') parts.push(`q=${encodeURIComponent(applied.q)}`);
    if (applied.dueFrom !== '') parts.push(`dueFrom=${applied.dueFrom}`);
    if (applied.dueTo !== '') parts.push(`dueTo=${applied.dueTo}`);
    return parts.join('&');
  }, [applied, offset]);

  const path = orgId === null ? null : `/api/organizations/${orgId}/recalls?${query}`;
  const { status, data, error, reload } = useApi<Paged & { recalls: Recall[] }>(path);
  const recalls = data?.recalls ?? [];
  const isFiltered = applied !== EMPTY;

  const closeRecall = async (): Promise<void> => {
    if (orgId === null || closeTarget === null) return;
    clearFeedback();
    setFlash(null);
    const recallId = closeTarget.id;
    const ok = await submit(async () => {
      await apiFetch(`/api/organizations/${orgId}/recalls/${recallId}/close`, {
        method: 'POST',
        body: { reason: closeReason },
      });
      return true;
    });
    if (ok !== null) {
      setFlash('Recall closed.');
      setCloseTarget(null);
      setCloseReason('staff_closed');
      reload();
    }
  };

  return (
    <div>
      <PageHeader
        title="Recall"
        subtitle="Patients due for a follow-up, and what happened after contact"
      />
      {flash ? <Flash kind="success" message={flash} onDismiss={() => setFlash(null)} /> : null}

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
            <FormField label="Status">
              <select
                className="select"
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              >
                <option value="">Any status</option>
                {options(RECALL_STATUSES).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Patient" hint="Name or phone">
              <input
                className="input"
                type="search"
                value={draft.q}
                onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              />
            </FormField>
            <FormField label="Due from">
              <input
                className="input"
                type="date"
                value={draft.dueFrom}
                onChange={(e) => setDraft({ ...draft, dueFrom: e.target.value })}
              />
            </FormField>
            <FormField label="Due to">
              <input
                className="input"
                type="date"
                value={draft.dueTo}
                onChange={(e) => setDraft({ ...draft, dueTo: e.target.value })}
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
        <h2 className="card-title">Recall list</h2>
        {status === 'loading' && data === null ? <LoadingState label="Loading recalls…" /> : null}
        {status === 'error' && data === null ? (
          <ErrorState message={error ?? 'Recalls could not be loaded.'} onRetry={reload} />
        ) : null}
        {data !== null && recalls.length === 0 ? (
          <EmptyState
            title="No recalls found"
            description={
              isFiltered
                ? 'No recalls match the current filters. Try resetting them.'
                : 'Recalls open automatically when a completed appointment reaches its follow-up interval.'
            }
          />
        ) : null}
        {data !== null && recalls.length > 0 ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Recall table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Type</th>
                  <th scope="col">Due date</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last contacted</th>
                  <th scope="col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {recalls.map((recall) => (
                  <tr key={recall.id}>
                    <td>
                      <Link to={`/patients/${recall.patientId}`}>
                        {recall.patient.firstName} {recall.patient.lastName}
                      </Link>
                      <div style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                        {recall.patient.phone}
                      </div>
                    </td>
                    <td>{recall.recallType}</td>
                    <td>{formatDate(recall.dueDate)}</td>
                    <td>
                      <StatusBadge label={recall.status} tone={recallTone(recall.status)} />
                      {recall.closeReason !== null ? (
                        <div style={{ fontSize: 'var(--fs-label)', color: 'var(--color-text-secondary)' }}>
                          {recall.closeReason}
                        </div>
                      ) : null}
                    </td>
                    <td>{recall.lastContactedAt === null ? '—' : formatDate(recall.lastContactedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link
                        className="btn btn-secondary"
                        to={`/communications?recipient=${encodeURIComponent(recall.patient.phone)}`}
                      >
                        Contact
                      </Link>{' '}
                      <Link
                        className="btn btn-secondary"
                        to={`/appointments?new=1&phone=${encodeURIComponent(recall.patient.phone)}`}
                      >
                        Book
                      </Link>
                      {canManage && recall.status !== 'CLOSED' ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => {
                              setCloseReason('staff_closed');
                              setCloseTarget(recall);
                              clearFeedback();
                            }}
                          >
                            Close
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data !== null ? (
          <Pager total={data.total} limit={data.limit} offset={data.offset} onOffset={setOffset} />
        ) : null}
      </section>

      <ConfirmDialog
        open={closeTarget !== null}
        title="Close this recall?"
        body="Closing stops pending recall messages. The recall stays in history with the reason you choose."
        confirmLabel="Close recall"
        danger
        busy={saving}
        onConfirm={() => void closeRecall()}
        onCancel={() => setCloseTarget(null)}
      >
        <FormField label="Reason" required>
          <select
            className="select"
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
          >
            {CLOSE_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason.replace('_', ' ')}
              </option>
            ))}
          </select>
        </FormField>
        {actionError ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
      </ConfirmDialog>
    </div>
  );
}
