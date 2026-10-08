import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { useSubmit } from '../../lib/useAsync';
import type { PaymentStatusResult } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Flash } from '../../components/Flash';

export function MockCheckoutPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { submit, saving, error, clearFeedback } = useSubmit();
  const [result, setResult] = useState<PaymentStatusResult | null>(null);

  const valid = orgId !== null && orderId !== undefined && /^[A-Za-z0-9]{1,64}$/.test(orderId);

  async function completeMock(outcome: 'paid' | 'failed'): Promise<void> {
    if (orgId === null || orderId === undefined) return;
    const res = await submit(() =>
      apiFetch<PaymentStatusResult>(
        `/api/organizations/${orgId}/billing/payments/${orderId}/mock-complete`,
        { method: 'POST', body: { result: outcome } },
      ),
    );
    if (res !== null) {
      setResult(res);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mock payment"
        subtitle="Development checkout — the AssanPay merchant account is not live yet"
      />
      {error !== null ? <Flash kind="error" message={error} onDismiss={clearFeedback} /> : null}
      {result !== null ? (
        <Flash
          kind={result.status === 'paid' ? 'success' : 'error'}
          message={
            result.status === 'paid'
              ? 'Mock payment recorded as paid.'
              : 'Mock payment recorded as failed.'
          }
        />
      ) : null}
      <section className="card">
        <h2 className="card-title">Order {orderId ?? ''}</h2>
        {!valid ? (
          <p className="text-muted">This mock checkout link is not valid.</p>
        ) : (
          <div>
            <p className="text-muted">
              This screen simulates the hosted AssanPay payment page so the upgrade flow can be
              tested before the merchant account is issued. No money moves.
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || result !== null}
                onClick={() => {
                  void completeMock('paid');
                }}
              >
                {saving ? 'Recording…' : 'Simulate successful payment'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving || result !== null}
                onClick={() => {
                  void completeMock('failed');
                }}
              >
                Simulate failed payment
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  navigate(`/settings/billing${orderId !== undefined ? `?orderId=${orderId}` : ''}`);
                }}
              >
                Back to billing
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
