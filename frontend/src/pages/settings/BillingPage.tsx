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
import { formatDateTime } from '../../lib/format';
import { formatMinor } from '../../lib/money';
import { browserLanguages, pickRegion, readStoredRegion, storeRegion } from '../../lib/region';
import type { BillingPhase, BillingState, ManualPaymentMethod, RegionalPrice } from '../../lib/types';

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 5;

function formatUsd(amountUsdCents: number | null): string {
  if (amountUsdCents === null || !Number.isInteger(amountUsdCents) || amountUsdCents < 1) {
    return 'Contact us';
  }
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
  const [chosenRegion, setChosenRegion] = useState<string | null>(() => readStoredRegion());
  const [methodKey, setMethodKey] = useState('');
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const checkStatus = useCallback(
    async (orderId: string): Promise<'paid' | 'failed' | 'pending' | 'error'> => {
      if (orgId === null) return 'error';
      try {
        const result = await apiFetch<PaymentStatusResult>(
          `/api/organizations/${orgId}/billing/payments/${orderId}/status`,
        );
        reload();
        if (result.status === 'paid') {
          setBanner({
            kind: 'success',
            text: 'Payment received. This clinic\'s paid period has been extended by one month.',
          });
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

  async function submitManual(): Promise<void> {
    if (orgId === null || selectedRegion === null || selectedMethod === null) return;
    if (reference.trim().length < 3) {
      setBanner({ kind: 'error', text: 'Enter the payment reference from your transfer.' });
      return;
    }
    let receipt: { contentType: string; dataBase64: string } | null = null;
    if (receiptFile !== null) {
      if (receiptFile.size > 1_500_000) {
        setBanner({ kind: 'error', text: 'The receipt must be 1.5 MB or smaller.' });
        return;
      }
      if (
        receiptFile.type !== 'image/jpeg' &&
        receiptFile.type !== 'image/png' &&
        receiptFile.type !== 'application/pdf'
      ) {
        setBanner({ kind: 'error', text: 'The receipt must be a JPEG, PNG, or PDF.' });
        return;
      }
      const dataUrl = await receiptFile.arrayBuffer();
      const bytes = new Uint8Array(dataUrl);
      let binary = '';
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      receipt = { contentType: receiptFile.type, dataBase64: btoa(binary) };
    }
    setBanner(null);
    const result = await submit(() =>
      apiFetch<{ payment: { orderId: string } }>(`/api/organizations/${orgId}/billing/manual`, {
        method: 'POST',
        body: {
          regionCode: selectedRegion.code,
          methodKey: selectedMethod.key,
          reference: reference.trim(),
          receipt,
        },
      }),
    );
    if (result !== null) {
      setReference('');
      setReceiptFile(null);
      setBanner({
        kind: 'success',
        text: `Payment ${result.payment.orderId} was sent for review. The paid period extends when it is confirmed.`,
      });
      reload();
    }
  }

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
  const regionList: RegionalPrice[] = summary?.regions ?? [];
  const regionCode =
    regionList.length === 0
      ? (chosenRegion ?? 'us')
      : pickRegion(
          regionList.map((region) => region.code),
          browserLanguages(),
          chosenRegion,
        );
  const selectedRegion = regionList.find((region) => region.code === regionCode) ?? null;
  const methods: ManualPaymentMethod[] = (summary?.manualMethods ?? []).filter((method) =>
    selectedRegion === null ? false : method.regionCodes.includes(selectedRegion.code),
  );
  const selectedMethod = methods.find((method) => method.key === methodKey) ?? methods[0] ?? null;
  const plan = summary?.organization.plan ?? null;
  const trialEnded =
    plan === 'trial' &&
    summary?.organization.trialEndsAt !== null &&
    summary?.organization.trialEndsAt !== undefined &&
    Date.parse(summary.organization.trialEndsAt) <= Date.now();
  const billing: BillingState = summary?.billing ?? {
    phase: plan === 'full' ? 'unmetered' : trialEnded ? 'trial_expired' : 'trial',
    readOnly: trialEnded,
    paidUntil: summary?.organization.paidUntil ?? null,
    graceDays: 3,
    noticeDays: 7,
  };
  const phase: BillingPhase = billing.phase;
  const paidUntilLabel =
    billing.paidUntil === null ? null : formatDateTime(billing.paidUntil);
  const showRenew = phase === 'renewal_due' || phase === 'grace' || phase === 'expired' || phase === 'active';
  const showUpgrade = phase === 'trial' || phase === 'trial_expired' || phase === 'unmetered';

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
                tone={phase === 'expired' || phase === 'trial_expired' ? 'danger' : plan === 'full' ? 'success' : 'warn'}
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
              {paidUntilLabel !== null ? (
                <StatusBadge label={`Paid until ${paidUntilLabel}`} tone={phase === 'expired' ? 'danger' : 'default'} />
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
            {phase === 'renewal_due' ? (
              <div className="billing-notice" role="status">
                Renewal is due. This clinic is paid until {paidUntilLabel}. Renew to add another month
                on top of that date.
              </div>
            ) : null}
            {phase === 'grace' ? (
              <div className="billing-notice" role="status">
                The paid period ended {paidUntilLabel}. Access continues during the {billing.graceDays}-day
                grace period. Renew to avoid a read-only lock.
              </div>
            ) : null}
            {phase === 'expired' ? (
              <div className="billing-notice billing-notice-danger" role="alert">
                The subscription ended {paidUntilLabel}. This clinic is read-only: existing records stay
                available and patient automations are not sent. Renew to restore full access.
              </div>
            ) : null}
            {phase === 'active' && paidUntilLabel !== null ? (
              <p className="text-muted">Paid until {paidUntilLabel}. A renewal adds one month from that date.</p>
            ) : null}
            {phase === 'unmetered' ? (
              <p className="text-muted">This clinic is on the Full Plan with no renewal date on file.</p>
            ) : null}
            {showUpgrade || showRenew ? (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={saving || !summary.gateway.enabled || summary.price.amountUsdCents === null}
                  onClick={() => {
                    void startCheckout();
                  }}
                >
                  {saving
                    ? 'Redirecting…'
                    : summary.price.amountUsdCents === null
                      ? 'Contact us'
                      : `${showRenew && !showUpgrade ? 'Renew' : 'Upgrade'} — ${formatUsd(summary.price.amountUsdCents)}/${summary.price.interval}`}
                </button>
              </div>
            ) : null}
            {!summary.gateway.enabled && (showUpgrade || showRenew) ? (
              <>
                <p className="text-muted" style={{ marginTop: 'var(--space-2)' }}>
                  {summary.gateway.reasons.join(' · ') || 'Payment gateway is not enabled.'}
                </p>
                <p className="text-muted">
                  Online card checkout stays off until the operator turns the gateway on. Bank transfer is below.
                </p>
              </>
            ) : null}
          </section>

          <section className="card" style={{ marginTop: 'var(--space-4)' }}>
            <h2 className="card-title">Pay by bank transfer</h2>
            <p className="text-muted">
              Choose your region, follow the instructions, then send the reference from your transfer.
              A receipt image or PDF is optional.
            </p>
            {regionList.length > 0 ? (
              <label className="region-picker">
                Region
                <select
                  aria-label="Payment region"
                  value={selectedRegion?.code ?? ''}
                  onChange={(event) => {
                    setChosenRegion(event.target.value);
                    storeRegion(event.target.value);
                    setMethodKey('');
                  }}
                >
                  {regionList.map((region) => (
                    <option key={region.code} value={region.code}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {selectedRegion !== null ? (
              <p>
                <strong>
                  {formatMinor(selectedRegion.amountMinor, selectedRegion.currency)} per month
                </strong>
                {selectedRegion.placeholder ? ' (placeholder amount until the operator sets it)' : ''}
              </p>
            ) : (
              <p>Contact us for a bank-transfer price. No regional price is saved.</p>
            )}
            {methods.length === 0 ? (
              <p>Payment instructions for this region have not been published yet.</p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitManual();
                }}
              >
                <label>
                  Payment method
                  <select
                    aria-label="Payment method"
                    value={selectedMethod?.key ?? ''}
                    onChange={(event) => setMethodKey(event.target.value)}
                  >
                    {methods.map((method) => (
                      <option key={method.key} value={method.key}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedMethod !== null ? (
                  <pre className="instructions-box">{selectedMethod.instructions}</pre>
                ) : null}
                <label>
                  Payment reference
                  <input
                    className="input"
                    aria-label="Payment reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Receipt (optional)
                  <input
                    aria-label="Receipt file"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <div className="btn-row">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Sending…' : 'Submit payment for review'}
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="card" style={{ marginTop: 'var(--space-4)' }}>
            <h2 className="card-title">Payment history</h2>
            {summary.payments.length === 0 ? (
              <EmptyState
                title="No payments yet"
                description="Payments made for this clinic will appear here."
                preview={
                  <p>
                    <span className="badge badge-success">Sample</span> Example only — a paid monthly
                    renewal would be listed here. Not saved data.
                  </p>
                }
              />
            ) : (
              <div className="table-scroll table-cards">
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
                          {payment.amountMinor != null
                            ? formatMinor(payment.amountMinor, payment.currency)
                            : `${formatUsd(payment.amountUsdCents)} ${payment.currency}`}
                        </td>
                        <td>
                          <StatusBadge
                            label={payment.status}
                            tone={STATUS_TONE[payment.status] ?? 'default'}
                          />
                        </td>
                        <td>
                          {payment.status === 'pending' && payment.provider !== 'manual' ? (
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
