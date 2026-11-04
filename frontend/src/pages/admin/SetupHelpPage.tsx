import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { PageHeader } from '../../components/PageHeader';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState, StatusBadge } from '../../components/states';
import { formatDateTime } from '../../lib/format';

interface SetupHelpRequest {
  id: number;
  organizationName: string;
  note: string | null;
  status: 'open' | 'closed';
  createdAt: string;
}

export function SetupHelpPage() {
  const { status, data, error, reload } = useApi<{ requests: SetupHelpRequest[] }>('/api/admin/setup-help');
  const { submit, saving, error: actionError, clearFeedback } = useSubmit();

  async function closeRequest(id: number): Promise<void> {
    const res = await submit(() =>
      apiFetch(`/api/admin/setup-help/${id}/close`, { method: 'POST' }),
    );
    if (res !== null) reload();
  }

  const requests = data?.requests ?? [];

  return (
    <div>
      <PageHeader
        title="Setup help"
        subtitle="Clinics that asked for free help getting started"
      />
      {actionError !== null ? <Flash kind="error" message={actionError} onDismiss={clearFeedback} /> : null}
      {status === 'loading' ? <LoadingState label="Loading requests…" /> : null}
      {status === 'error' ? <ErrorState message={error ?? 'Requests could not be loaded.'} onRetry={reload} /> : null}
      {data !== null && requests.length === 0 ? <p>No setup help requests yet.</p> : null}
      {requests.map((request) => (
        <section className="card" key={request.id} style={{ marginBottom: 'var(--space-3)' }}>
          <h2 className="card-title">{request.organizationName}</h2>
          <StatusBadge label={request.status} tone={request.status === 'open' ? 'warn' : 'success'} />
          <p>{formatDateTime(request.createdAt)}</p>
          <p>{request.note ?? 'No note.'}</p>
          {request.status === 'open' ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => {
                void closeRequest(request.id);
              }}
            >
              Mark closed
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}
