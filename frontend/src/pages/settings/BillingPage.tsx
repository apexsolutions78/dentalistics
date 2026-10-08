import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { apiFetch, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { useSubmit } from '../../lib/useAsync';
import type { BillingSummary, CheckoutPayment, PaymentStatusResult } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Flash } from '../../components/Flash';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '../../components/states';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 5;

function formatUsd(amountUsdCents: number): string {
  return `$${(amountUsdCents / 100).toFixed(2)}`;
}

const STATUS_TONE: Record<string, 'default' | 'success' | 'warn' | 'danger'> = {
  pending: 'warn',
  paid: 'success',
  failed: 'danger',
  expired: 'danger',
  cancelled: 'default',
};

export function BillingPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? null;
  const path = orgId === null ? null : `/api/organizations/${orgId}/billing`;
  const { status, data, error, reload } = useApi<BillingSummary>(path);
  const { submit, saving, error: actionError, clearFeedback } = useSubmit();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdParam = searchParams.get('orderId');
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const checkStatus = useCallback(
    async (orderId: string): Promise<'paid' | 'failed' | 'pending' | 'error'> => {
      if (orgId === null) return 'error';
      try {
        const result = await apiFetch<PaymentStatusResult>(
          `/api/organizations/${orgId}/billing/payments/${orderId}/status`,
        );
        reload();
        if (result.status === 'paid') {
          setBanner({ kind: 'success', text: 'Payment received. This clinic is now on the Full Plan.' });
          return 'paid';
        }
        if (result.status === 'failed' || result.status === 'expired') {
          setBanner({ kind: 'error', text: 'The payment did not complete. Please try again.' });
          return 'failed';
        }
        return 'pending';
      } catch (err) {
        setBanner({ kind: 'error', text: errorMessage(err) });
        return 'error';
      }
    },
    [orgId, reload],
  );

  useEffect(() => {
    if (orderIdParam === null || orgId === null) return undefined;
    const orderId = orderIdParam;
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;

    async function run(): Promise<void> {
      for (;;) {
        const outcome = await checkStatus(orderId);
        if (cancelled || outcome !== 'pending') return;
        attempts += 1;
        if (attempts > POLL_ATTEMPTS) {
          if (!cancelled) {
            setBanner({ kind: 'success', text: 'Payment still pending — use Check status below to refresh.' });
          }
          return;
        }
        await new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [orderIdParam, orgId, checkStatus]);

  async function startCheckout(): Promise<void> {
    if (orgId === null) return;
    setBanner(null);
    const result = await submit(() =>
      apiFetch<{ payment: CheckoutPayment }>(`/api/organizations/${orgId}/billing/checkout`, {
        method: 'POST',
      }),
    );
    if (result === null) return;
    const checkoutUrl = result.payment.checkoutUrl;
    if (checkoutUrl.startsWith('/')) {
      navigate(checkoutUrl);
    } else {
      window.location.assign(checkoutUrl);
    }
  }

  const summary = data;
  const plan = summary?.organization.plan ?? null;
  const trialEnded =
    plan === 'trial' &&
    summary?.organization.trialEndsAt !== null &&
    summary?.organization.trialEndsAt !== undefined &&
    Date.parse(summary.organization.trialEndsAt) <= Date.now();

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Plan, pricing, and payment history for this clinic"
        actions={
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Refresh
          </button>
        }
      />
      {banner !== null ? (
        <Flash kind={banner.kind} message={banner.text} onDismiss={() => setBanner(null)} />
      ) : null}
      {actionError !== null ? (
        <Flash kind="error" message={actionError} onDismiss={clearFeedback} />
      ) : null}
      {status === 'loading' ? <LoadingState label="Loading billing…" /> : null}
      {status === 'error' ? <ErrorState message={error ?? 'Something went wrong.'} onRetry={reload} /> : null}
      {summary !== null ? (
        <div>
          <section className="card">
            <h2 className="card-title">Current plan</h2>
            <div className="provider-status">
              <StatusBadge
                label={plan === 'full' ? 'Full Plan' : 'Free trial'}
                tone={plan === 'full' ? 'success' : trialEnded ? 'danger' : 'warn'}
              />
              {plan === 'trial' ? (
                <StatusBadge
                  label={
                    summary.organization.trialEndsAt === null
                      ? 'No expiry set'
                      : trialEnded
                        ? 'Trial ended — clinic is read-only until activated'
                        : `Trial until ${new Date(summary.organization.trialEndsAt).toLocaleDateString()}`
                  }
                  tone={trialEnded ? 'danger' : 'default'}
                />
              ) : null}
              <StatusBadge
                label={summary.gateway.enabled ? 'Online payment available' : 'Online payment unavailable'}
                tone={summary.gateway.enabled ? 'success' : 'default'}
              />
            </div>
            <p style={{ marginTop: 'var(--space-3)' }}>
              <strong>{summary.price.name}</strong> — {formatUsd(summary.price.amountUsdCents)}{' '}
              {summary.price.currency} per {summary.price.interval}
            </p>
            {plan === 'full' ? (
              <p className="text-muted">This clinic is already on the Full Plan.</p>
            ) : (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !summary.gateway.enabled}
                  onClick={() => {
                    void startCheckout();
                  }}
                >
                  {saving
                    ? 'Redirecting…'
                    : `Upgrade — ${formatUsd(summary.price.amountUsdCents)}/${summary.price.interval}`}
                </button>
              </div>
            )}
            {!summary.gateway.enabled && plan !== 'full' ? (
              <p className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
                {summary.gateway.reasons.join(' · ') || 'Payment gateway is not enabled.'}
              </p>
            ) : null}
          </section>

          <section className="card" style={{ marginTop: 'var(--space-4)' }}>
            <h2 className="card-title">Payment history</h2>
            {summary.payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Payments made for this clinic will appear here."
              />
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.payments.map((payment) => (
                      <tr key={payment.orderId}>
                        <td>{payment.orderId}</td>
                        <td>{new Date(payment.createdAt).toLocaleString()}</td>
                        <td>
                          {formatUsd(payment.amountUsdCents)} {payment.currency}
                        </td>
                        <td>
                          <StatusBadge
                            label={payment.status}
                            tone={STATUS_TONE[payment.status] ?? 'default'}
                          />
                        </td>
                        <td>
                          {payment.status === 'pending' ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => {
                                void (async () => {
                                  const outcome = await checkStatus(payment.orderId);
                                  if (outcome === 'pending') {
                                    setBanner({
                                      kind: 'success',
                                      text: 'Payment still pending — try again shortly.',
                                    });
                                  }
                                })();
                              }}
                            >
                              Check status
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
