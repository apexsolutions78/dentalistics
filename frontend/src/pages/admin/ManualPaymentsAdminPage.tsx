import { useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import { formatMinor } from '../../lib/money';
import type { ManualPaymentMethod, RegionalPrice } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Flash } from '../../components/Flash';
import { ErrorState, LoadingState, StatusBadge } from '../../components/states';
import { formatDateTime } from '../../lib/format';

interface MethodsResponse {
  methods: ManualPaymentMethod[];
}

interface PricesResponse {
  regions: RegionalPrice[];
}

interface ManualPayment {
  id: number;
  organizationName: string;
  amountMinor: number | null;
  currency: string;
  status: string;
  methodKey: string | null;
  orderId: string;
  reference: string | null;
  hasReceipt: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

export function ManualPaymentsAdminPage() {
  const methodsQuery = useApi<MethodsResponse>('/api/admin/payment-methods');
  const pricesQuery = useApi<PricesResponse>('/api/admin/regional-prices');
  const paymentsQuery = useApi<{ payments: ManualPayment[] }>('/api/admin/manual-payments?status=pending');
  const { submit, saving, error, saved, clearFeedback } = useSubmit();
  const [drafts, setDrafts] = useState<Record<string, ManualPaymentMethod>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});

  const methods = methodsQuery.data?.methods ?? [];
  const regions = pricesQuery.data?.regions ?? [];

  function draftFor(method: ManualPaymentMethod): ManualPaymentMethod {
    return drafts[method.key] ?? method;
  }

  function patch(method: ManualPaymentMethod, next: Partial<ManualPaymentMethod>): void {
    setDrafts((prev) => ({ ...prev, [method.key]: { ...draftFor(method), ...next } }));
    clearFeedback();
  }

  async function save(method: ManualPaymentMethod): Promise<void> {
    const value = draftFor(method);
    const res = await submit(() =>
      apiFetch(`/api/admin/payment-methods/${method.key}`, {
        method: 'PATCH',
        body: {
          label: value.label,
          instructions: value.instructions,
          enabled: value.enabled === true,
          regionCodes: value.regionCodes,
        },
      }),
    );
    if (res !== null) {
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[method.key];
        return copy;
      });
      methodsQuery.reload();
    }
  }

  async function review(id: number, decision: 'confirm' | 'reject'): Promise<void> {
    const res = await submit(() =>
      apiFetch(`/api/admin/manual-payments/${id}/${decision}`, {
        method: 'POST',
        body: decision === 'reject' ? { reason: reasons[id] ?? '' } : {},
      }),
    );
    if (res !== null) paymentsQuery.reload();
  }

  return (
    <div>
      <PageHeader
        title="Manual payments"
        subtitle="Write the bank details clinics should follow. Nothing here is hard-coded. Confirming a payment adds one month to paid until."
      />
      {saved ? <Flash kind="success" message="Saved." onDismiss={clearFeedback} /> : null}
      {error !== null ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}
      {methodsQuery.status === 'loading' ? <LoadingState label="Loading payment methods…" /> : null}
      {methodsQuery.status === 'error' ? (
        <ErrorState message={methodsQuery.error ?? 'Payment methods could not be loaded.'} onRetry={methodsQuery.reload} />
      ) : null}

      {methods.map((method) => {
        const value = draftFor(method);
        return (
          <section className="card" key={method.key} style={{ marginBottom: 'var(--space-3)' }}>
            <h2 className="card-title">{value.label}</h2>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={value.enabled === true}
                onChange={(event) => patch(method, { enabled: event.target.checked })}
              />
              Clinics can choose this method
            </label>
            <label>
              Label
              <input
                className="input"
                aria-label={`${method.key} label`}
                value={value.label}
                onChange={(event) => patch(method, { label: event.target.value })}
              />
            </label>
            <label>
              Payment instructions
              <textarea
                className="input"
                aria-label={`${method.key} instructions`}
                rows={5}
                value={value.instructions}
                onChange={(event) => patch(method, { instructions: event.target.value })}
              />
            </label>
            <fieldset>
              <legend>Regions</legend>
              {regions.map((region) => (
                <label className="checkbox-row" key={region.code}>
                  <input
                    type="checkbox"
                    checked={value.regionCodes.includes(region.code)}
                    onChange={(event) => {
                      const regionCodes = event.target.checked
                        ? [...value.regionCodes, region.code]
                        : value.regionCodes.filter((code) => code !== region.code);
                      patch(method, { regionCodes });
                    }}
                  />
                  {region.label}
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => {
                void save(method);
              }}
            >
              Save {value.label}
            </button>
          </section>
        );
      })}

      <section className="card">
        <h2 className="card-title">Waiting for review</h2>
        {paymentsQuery.status === 'loading' ? <LoadingState label="Loading payments…" /> : null}
        {paymentsQuery.status === 'error' ? (
          <ErrorState message={paymentsQuery.error ?? 'Payments could not be loaded.'} onRetry={paymentsQuery.reload} />
        ) : null}
        {(paymentsQuery.data?.payments.length ?? 0) === 0 && paymentsQuery.data !== null ? (
          <p>No manual payments are waiting.</p>
        ) : null}
        {(paymentsQuery.data?.payments ?? []).map((payment) => (
          <article key={payment.id} className="card" style={{ marginTop: 'var(--space-3)' }}>
            <p>
              <strong>{payment.organizationName}</strong> · {payment.orderId} ·{' '}
              {payment.amountMinor !== null ? formatMinor(payment.amountMinor, payment.currency) : payment.currency}
            </p>
            <p>
              {payment.methodKey} · reference {payment.reference} · {formatDateTime(payment.createdAt)}
            </p>
            <StatusBadge label={payment.status} tone="warn" />
            {payment.hasReceipt ? (
              <p>
                <a href={`/api/admin/manual-payments/${payment.id}/receipt`}>Download receipt</a>
              </p>
            ) : null}
            <label>
              Rejection reason
              <input
                className="input"
                aria-label={`Rejection reason for ${payment.orderId}`}
                value={reasons[payment.id] ?? ''}
                onChange={(event) => setReasons((prev) => ({ ...prev, [payment.id]: event.target.value }))}
              />
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => {
                  void review(payment.id, 'confirm');
                }}
              >
                Confirm and extend
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => {
                  void review(payment.id, 'reject');
                }}
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
